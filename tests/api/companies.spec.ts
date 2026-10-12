import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";

/**
 * Companies (accounts) API: every endpoint × every role, 401, cross-workspace isolation, validation,
 * CSRF, dedupe by domain and CSV import/export. Every test creates its own uniquely named records.
 */

test.describe.configure({ timeout: 120_000 });

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Account {
  id: string;
  name: string;
  domain: string | null;
  stage: string;
  industry: string | null;
  employeeCount: number | null;
  contactCount: number;
  owner: { id: string } | null;
}

async function makeAccount(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<Account> {
  const tag = uid();
  const res = await api.post("/api/v1/accounts", {
    data: { name: `Spec Co ${tag}`, domain: `co-${tag}.companies-spec.example`, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).account;
}

const owner = () => apiAsRole("owner");

test.describe("accounts: role matrix", () => {
  test("POST /accounts", async () => {
    for (const role of ROLES) {
      const tag = uid();
      const res = await (await apiAsRole(role)).post("/api/v1/accounts", {
        data: { name: `Create ${role} ${tag}`, domain: `https://www.create-${tag}.companies-spec.example/about` },
      });
      expect(res.status(), role).toBe(expected(role, "company:create", 201));
      if (res.ok()) {
        const { account } = await res.json();
        expect(account.domain).toBe(`create-${tag}.companies-spec.example`);
        expect(account.websiteUrl).toBe(`https://create-${tag}.companies-spec.example`);
      }
    }
  });

  test("POST /accounts/search", async () => {
    const created = await makeAccount(await owner());
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/accounts/search", { data: { q: created.domain } });
      expect(res.status(), role).toBe(expected(role, "company:read"));
      const body = await res.json();
      expect(body.accounts.map((a: Account) => a.id)).toEqual([created.id]);
      expect(body.pagination.total_entries).toBe(1);
    }
  });

  test("GET, PATCH, DELETE /accounts/:id", async () => {
    for (const role of ROLES) {
      const target = await makeAccount(await owner());
      const api = await apiAsRole(role);
      const read = await api.get(`/api/v1/accounts/${target.id}`);
      expect(read.status(), `${role} read`).toBe(expected(role, "company:read"));

      const patch = await api.patch(`/api/v1/accounts/${target.id}`, {
        data: { industry: `Patched ${role}`, employeeCount: 42 },
      });
      expect(patch.status(), `${role} patch`).toBe(expected(role, "company:update"));
      if (patch.ok())
        expect((await patch.json()).account).toMatchObject({ industry: `Patched ${role}`, employeeCount: 42 });

      const del = await api.delete(`/api/v1/accounts/${target.id}`);
      expect(del.status(), `${role} delete`).toBe(expected(role, "company:delete"));
      expect((await (await owner()).get(`/api/v1/accounts/${target.id}`)).status()).toBe(del.ok() ? 404 : 200);
    }
  });

  test("GET /accounts/:id/provenance", async () => {
    const target = await makeAccount(await owner(), { industry: "Provenance" });
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get(`/api/v1/accounts/${target.id}/provenance`);
      expect(res.status(), role).toBe(expected(role, "company:read"));
      const fields = (await res.json()).provenance.map(
        (p: { field: string; source: string }) => `${p.field}:${p.source}`,
      );
      expect(fields).toEqual(expect.arrayContaining(["industry:manual", "domain:manual", "name:manual"]));
    }
  });

  test("POST /accounts/bulk_create", async () => {
    for (const role of ROLES) {
      const tag = uid();
      const res = await (await apiAsRole(role)).post("/api/v1/accounts/bulk_create", {
        data: {
          accounts: [
            { name: "Bulk one", domain: `b1-${tag}.companies-spec.example` },
            { domain: `b2-${tag}.companies-spec.example` },
          ],
        },
      });
      expect(res.status(), role).toBe(expected(role, "company:create"));
      if (res.ok()) {
        const body = await res.json();
        expect(body.created_accounts).toHaveLength(2);
        expect(body.created_accounts.map((a: Account) => a.name)).toContain(`b2-${tag}.companies-spec.example`);
      }
    }
  });

  test("POST /accounts/bulk_update and update_owners", async () => {
    const api0 = await owner();
    const managerId = (await makeAccount(await apiAsRole("manager"))).owner?.id;
    expect(managerId).toBeTruthy();
    for (const role of ROLES) {
      const a = await makeAccount(api0);
      const b = await makeAccount(api0);
      const api = await apiAsRole(role);
      const bulk = await api.post("/api/v1/accounts/bulk_update", {
        data: { accountIds: [a.id, b.id], stage: "engaged", technologies: ["Postgres"] },
      });
      expect(bulk.status(), `${role} bulk_update`).toBe(expected(role, "company:update"));
      if (bulk.ok()) {
        expect((await bulk.json()).accounts.every((x: Account) => x.stage === "engaged")).toBe(true);
      }
      const owners = await api.post("/api/v1/accounts/update_owners", {
        data: { accountIds: [a.id, b.id], ownerId: managerId },
      });
      expect(owners.status(), `${role} update_owners`).toBe(expected(role, "company:update"));
      if (owners.ok()) {
        expect((await owners.json()).accounts.every((x: Account) => x.owner?.id === managerId)).toBe(true);
      }
    }
  });

  test("POST /accounts/bulk_delete", async () => {
    for (const role of ROLES) {
      const a = await makeAccount(await owner());
      const res = await (await apiAsRole(role)).post("/api/v1/accounts/bulk_delete", { data: { accountIds: [a.id] } });
      expect(res.status(), role).toBe(expected(role, "company:delete"));
    }
  });

  test("GET /account_stages", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/account_stages");
      expect(res.status(), role).toBe(expected(role, "company:read"));
      expect((await res.json()).account_stages.map((s: { id: string }) => s.id)).toEqual([
        "cold",
        "prospect",
        "engaged",
        "customer",
        "churned",
      ]);
    }
  });

  test("POST /mixed_companies/search", async () => {
    const api0 = await owner();
    const tag = uid();
    const hit = await makeAccount(api0, {
      name: `Mixed ${tag} one`,
      industry: `Robotics ${tag}`,
      country: "Germany",
      employeeCount: 500,
      technologies: ["Kubernetes", "React"],
    });
    await makeAccount(api0, { name: `Mixed ${tag} two`, industry: `Robotics ${tag}`, employeeCount: 5 });
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/mixed_companies/search", {
        data: { q: tag, employeesMin: 100, employeesMax: 1000, technologies: ["react"], country: ["germany"] },
      });
      expect(res.status(), role).toBe(expected(role, "search:run"));
      expect((await res.json()).organizations.map((a: Account) => a.id)).toEqual([hit.id]);
    }
    const apollo = await api0.post("/api/v1/mixed_companies/search", {
      data: {
        q_organization_name: tag,
        organization_num_employees_ranges: ["250,1000"],
        q_organization_keyword_tags: [`robotics ${tag}`],
      },
    });
    expect((await apollo.json()).organizations.map((a: Account) => a.id)).toEqual([hit.id]);
  });

  test("POST /accounts/import and GET /accounts/export", async () => {
    for (const role of ROLES) {
      const tag = uid();
      const api = await apiAsRole(role);
      const imp = await api.post("/api/v1/accounts/import", {
        multipart: {
          file: {
            name: "companies.csv",
            mimeType: "text/csv",
            buffer: Buffer.from(`Company,Domain\nImport ${role} ${tag},imp-${tag}.companies-spec.example\n`),
          },
        },
      });
      expect(imp.status(), `${role} import`).toBe(expected(role, "company:import"));
      const exp = await api.get(`/api/v1/accounts/export?q=imp-${tag}`);
      expect(exp.status(), `${role} export`).toBe(expected(role, "company:export"));
      if (exp.ok()) expect(await exp.text()).toContain(`imp-${tag}.companies-spec.example`);
    }
  });
});

test.describe("accounts: authentication and CSRF", () => {
  test("unauthenticated requests get 401 everywhere", async () => {
    const api = await anonymous();
    const id = "00000000-0000-0000-0000-000000000000";
    const calls = [
      api.post("/api/v1/accounts", { data: { name: "x" } }),
      api.post("/api/v1/accounts/search", { data: {} }),
      api.get(`/api/v1/accounts/${id}`),
      api.patch(`/api/v1/accounts/${id}`, { data: { name: "x" } }),
      api.delete(`/api/v1/accounts/${id}`),
      api.get(`/api/v1/accounts/${id}/provenance`),
      api.post("/api/v1/accounts/bulk_create", { data: { accounts: [{ name: "x" }] } }),
      api.post("/api/v1/accounts/bulk_update", { data: { accountIds: [id], stage: "cold" } }),
      api.post("/api/v1/accounts/bulk_delete", { data: { accountIds: [id] } }),
      api.post("/api/v1/accounts/update_owners", { data: { accountIds: [id], ownerId: id } }),
      api.post("/api/v1/accounts/import", { data: { csv: "name\nx" } }),
      api.get("/api/v1/accounts/export"),
      api.get("/api/v1/account_stages"),
      api.post("/api/v1/mixed_companies/search", { data: {} }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status(), res.url()).toBe(401);
  });

  test("cookie writes from another origin are refused", async () => {
    const api = await owner();
    const target = await makeAccount(api);
    const evil = { origin: "https://evil.example" };
    const res = await Promise.all([
      api.post(`${BASE_URL}/api/v1/accounts`, { headers: evil, data: { name: `csrf ${uid()}` } }),
      api.patch(`${BASE_URL}/api/v1/accounts/${target.id}`, { headers: evil, data: { stage: "customer" } }),
      api.delete(`${BASE_URL}/api/v1/accounts/${target.id}`, { headers: evil }),
      api.post(`${BASE_URL}/api/v1/accounts/bulk_update`, {
        headers: evil,
        data: { accountIds: [target.id], stage: "customer" },
      }),
      api.post(`${BASE_URL}/api/v1/accounts/import`, { headers: evil, data: { csv: "name\nx" } }),
    ]);
    for (const r of res) expect(r.status(), r.url()).toBe(403);
    expect((await (await api.get(`/api/v1/accounts/${target.id}`)).json()).account.stage).toBe("cold");
  });
});

test.describe("accounts: workspace isolation", () => {
  test("another workspace gets 404 on Acme ids and never sees Acme rows", async () => {
    const acme = await owner();
    const tag = uid();
    const target = await makeAccount(acme, { name: `Isolated ${tag}` });
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/accounts/${target.id}`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/accounts/${target.id}/provenance`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/accounts/${target.id}`, { data: { stage: "customer" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/accounts/${target.id}`)).status()).toBe(404);
    for (const path of ["bulk_update", "update_owners", "bulk_delete"]) {
      const res = await globex.post(`/api/v1/accounts/${path}`, {
        data: { accountIds: [target.id], stage: "customer", ownerId: null },
      });
      expect(res.status(), path).toBe(404);
    }
    for (const path of ["/api/v1/accounts/search", "/api/v1/mixed_companies/search"]) {
      const body = await (await globex.post(path, { data: { q: tag } })).json();
      expect((body.accounts ?? body.organizations).length, path).toBe(0);
    }
    const all = await (await globex.post("/api/v1/accounts/search", { data: { per_page: 100 } })).json();
    expect(all.accounts.some((a: Account) => a.id === target.id)).toBe(false);
    expect(all.accounts.some((a: Account) => a.domain === "northwind.example")).toBe(false);
    const exported = await (await globex.get("/api/v1/accounts/export")).text();
    expect(exported).not.toContain(target.id);
    expect(exported).not.toContain("northwind.example");

    // The same domain can exist in two workspaces.
    const same = await globex.post("/api/v1/accounts", { data: { name: "Same domain", domain: target.domain } });
    expect(same.status()).toBe(201);
    // Acme's members are out of scope for Globex.
    expect(
      (
        await globex.patch(`/api/v1/accounts/${(await same.json()).account.id}`, {
          data: { ownerId: target.owner?.id },
        })
      ).status(),
    ).toBe(404);
  });
});

test.describe("accounts: validation and dedupe", () => {
  test("invalid bodies get 422", async () => {
    const api = await owner();
    const target = await makeAccount(api);
    const bad = [
      api.post("/api/v1/accounts", { data: {} }),
      api.post("/api/v1/accounts", { data: { name: "X", domain: "not a domain" } }),
      api.post("/api/v1/accounts", { data: { name: "X", stage: "hot" } }),
      api.post("/api/v1/accounts", { data: { name: "X", employeeCount: -1 } }),
      api.post("/api/v1/accounts", { data: { name: "X", employeeCount: "lots" } }),
      api.patch(`/api/v1/accounts/${target.id}`, { data: {} }),
      api.patch(`/api/v1/accounts/${target.id}`, { data: { name: null } }),
      api.post("/api/v1/accounts/search", { data: { stage: ["hot"] } }),
      api.post("/api/v1/accounts/search", { data: { employeesMin: "many" } }),
      api.post("/api/v1/accounts/bulk_update", { data: { accountIds: [target.id] } }),
      api.post("/api/v1/accounts/bulk_update", {
        data: { accountIds: Array.from({ length: 1001 }, (_, i) => `id-${i}`), stage: "cold" },
      }),
      api.post("/api/v1/accounts/update_owners", { data: { accountIds: [target.id] } }),
      api.post("/api/v1/accounts/bulk_create", { data: { accounts: [] } }),
      api.post("/api/v1/accounts/bulk_create", {
        data: { accounts: Array.from({ length: 101 }, (_, i) => ({ name: `n${i}` })) },
      }),
      api.post("/api/v1/accounts/bulk_create", { data: { accounts: [{ domain: "nope nope" }] } }),
      api.post("/api/v1/accounts/import", { data: { csv: "colour\nred\n" } }),
      api.get("/api/v1/accounts/export?stage=hot"),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status(), `${res.url()} ${await res.text()}`).toBe(422);
    }
  });

  test("domains are unique per workspace; runDedupe updates in place", async () => {
    const api = await owner();
    const tag = uid();
    const domain = `dedupe-${tag}.companies-spec.example`;
    const first = await makeAccount(api, { domain: `HTTPS://WWW.${domain.toUpperCase()}/` });
    expect(first.domain).toBe(domain);

    const dup = await api.post("/api/v1/accounts", { data: { name: "Dup", domain } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).details.existingId).toBe(first.id);

    const merged = await api.post("/api/v1/accounts", { data: { domain, industry: "Merged", runDedupe: true } });
    expect(merged.status()).toBe(200);
    expect((await merged.json()).account).toMatchObject({ id: first.id, industry: "Merged" });

    const other = await makeAccount(api);
    expect((await api.patch(`/api/v1/accounts/${other.id}`, { data: { domain } })).status()).toBe(409);

    const bulk = await (
      await api.post("/api/v1/accounts/bulk_create", {
        data: { accounts: [{ domain }, { name: "Fresh", domain: `fresh-${tag}.companies-spec.example` }] },
      })
    ).json();
    expect(bulk.created_accounts).toHaveLength(1);
    expect(bulk.existing_accounts.map((a: Account) => a.id)).toEqual([first.id]);
  });

  test("deleting a company keeps its people and unlinks them", async () => {
    const api = await owner();
    const acct = await makeAccount(api);
    const person = await api.post("/api/v1/contacts", {
      data: { firstName: "Linked", email: `linked-${uid()}@companies-spec.example`, companyId: acct.id },
    });
    expect(person.status()).toBe(201);
    const personId = (await person.json()).contact.id;
    expect((await (await api.get(`/api/v1/accounts/${acct.id}`)).json()).account.contactCount).toBe(1);
    expect((await api.delete(`/api/v1/accounts/${acct.id}`)).status()).toBe(200);
    const after = await (await api.get(`/api/v1/contacts/${personId}`)).json();
    expect(after.contact.company).toBeNull();
  });
});

test.describe("accounts: CSV round trip", () => {
  test("import, export, re-import updates instead of duplicating", async () => {
    const api = await owner();
    const tag = uid();
    const csv = [
      "Company Name;Website;Industry;Employees;Technologies;Country;Stage",
      `Orbit ${tag};https://www.orbit-${tag}.example/;Aerospace;"1,200";React|Go;Canada;customer`,
      `Nebula ${tag};nebula-${tag}.example;Aerospace;80;;Canada;`,
      `;;Aerospace;;;;`,
      `Orbit dup ${tag};orbit-${tag}.example;;;;;`,
      `Bad domain ${tag};;;;;;`,
    ].join("\r\n");
    const imp = await api.post("/api/v1/accounts/import", {
      multipart: { file: { name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
    expect(imp.status(), await imp.text()).toBe(200);
    const report = await imp.json();
    expect(report).toMatchObject({ total: 5, created: 3, updated: 0, skipped: 2 });
    expect(report.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);
    expect(report.columns).toMatchObject({ "Company Name": "name", Website: "websiteUrl", Employees: "employeeCount" });

    const found = await (
      await api.post("/api/v1/accounts/search", { data: { q: tag, sortBy: "name", sortAscending: true } })
    ).json();
    expect(found.accounts.map((a: Account) => a.name)).toEqual([`Bad domain ${tag}`, `Nebula ${tag}`, `Orbit ${tag}`]);
    const orbit = found.accounts[2];
    expect(orbit).toMatchObject({
      domain: `orbit-${tag}.example`,
      employeeCount: 1200,
      technologies: ["React", "Go"],
      stage: "customer",
      source: "csv_import",
    });
    const prov = await (await api.get(`/api/v1/accounts/${orbit.id}/provenance`)).json();
    expect(prov.provenance.filter((p: { source: string }) => p.source === "csv_import").length).toBeGreaterThan(4);

    const exported = await (await api.get(`/api/v1/accounts/export?q=${tag}`)).text();
    expect(exported.trim().split(/\r?\n/)).toHaveLength(4);
    const again = await api.post("/api/v1/accounts/import", { data: { csv: exported.replace("Aerospace", "Space") } });
    expect(await again.json()).toMatchObject({ total: 3, created: 0, updated: 3, skipped: 0 });
    const noUpdate = await api.post("/api/v1/accounts/import", { data: { csv: exported, updateExisting: false } });
    expect(await noUpdate.json()).toMatchObject({ created: 0, updated: 0, skipped: 3 });
  });
});
