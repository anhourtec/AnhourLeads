import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";

/**
 * People (contacts) API: every endpoint × every role, 401, cross-workspace isolation, validation,
 * CSRF, dedupe and CSV import/export. Every test creates its own uniquely named records.
 */

test.describe.configure({ timeout: 120_000 });

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Contact {
  id: string;
  email: string | null;
  firstName: string | null;
  stage: string;
  suppressed: boolean;
  owner: { id: string } | null;
  company: { id: string; name: string } | null;
}

async function makeContact(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<Contact> {
  const tag = uid();
  const res = await api.post("/api/v1/contacts", {
    data: { firstName: "Test", lastName: `Person ${tag}`, email: `p-${tag}@contacts-spec.example`, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).contact;
}

const owner = () => apiAsRole("owner");

test.describe("contacts: role matrix", () => {
  test("POST /contacts", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const tag = uid();
      const res = await api.post("/api/v1/contacts", {
        data: { firstName: "Role", lastName: role, email: `create-${role}-${tag}@contacts-spec.example` },
      });
      expect(res.status(), role).toBe(expected(role, "contact:create", 201));
      if (res.ok()) {
        const body = await res.json();
        expect(body.contact.email).toBe(`create-${role}-${tag}@contacts-spec.example`);
        expect(body.contact.suppressed).toBe(false);
      }
    }
  });

  test("POST /contacts/search", async () => {
    const created = await makeContact(await owner(), { title: `Searcher ${uid()}` });
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/contacts/search", { data: { q: created.email, per_page: 5 } });
      expect(res.status(), role).toBe(expected(role, "contact:read"));
      const body = await res.json();
      expect(body.contacts.map((c: Contact) => c.id)).toEqual([created.id]);
      expect(body.pagination).toMatchObject({ page: 1, per_page: 5, total_entries: 1, total_pages: 1 });
    }
  });

  test("GET, PATCH, DELETE /contacts/:id", async () => {
    for (const role of ROLES) {
      const target = await makeContact(await owner());
      const api = await apiAsRole(role);
      const read = await api.get(`/api/v1/contacts/${target.id}`);
      expect(read.status(), `${role} read`).toBe(expected(role, "contact:read"));
      expect((await read.json()).contact.id).toBe(target.id);

      const patch = await api.patch(`/api/v1/contacts/${target.id}`, { data: { title: `Patched by ${role}` } });
      expect(patch.status(), `${role} patch`).toBe(expected(role, "contact:update"));
      if (patch.ok()) expect((await patch.json()).contact.title).toBe(`Patched by ${role}`);

      const del = await api.delete(`/api/v1/contacts/${target.id}`);
      expect(del.status(), `${role} delete`).toBe(expected(role, "contact:delete"));
      const after = await (await owner()).get(`/api/v1/contacts/${target.id}`);
      expect(after.status()).toBe(del.ok() ? 404 : 200);
    }
  });

  test("POST /contacts with source browser_extension and a source page", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const tag = uid();
      const sourceUrl = `https://northwind.example/team/${tag}`;
      const res = await api.post("/api/v1/contacts", {
        data: {
          firstName: "Saved",
          lastName: `From page ${tag}`,
          title: "Engineer",
          source: "browser_extension",
          sourceUrl,
        },
      });
      expect(res.status(), role).toBe(expected(role, "contact:create", 201));
      if (!res.ok()) continue;
      const { contact } = await res.json();
      expect(contact.source).toBe("browser_extension");
      const prov = (await (await api.get(`/api/v1/contacts/${contact.id}/provenance`)).json()).provenance as {
        field: string;
        source: string;
        sourceUrl: string | null;
      }[];
      expect(prov.find((p) => p.field === "title")).toMatchObject({ source: "browser_extension", sourceUrl });
      expect(prov.map((p) => p.field)).not.toContain("sourceUrl");
    }
    const owner = await apiAsRole("owner");
    for (const data of [
      { firstName: "Bad", source: "crawler" },
      { firstName: "Bad", source: "browser_extension", sourceUrl: "javascript:alert(1)" },
      { firstName: "Bad", sourceUrl: "not a url" },
    ]) {
      expect((await owner.post("/api/v1/contacts", { data })).status(), JSON.stringify(data)).toBe(422);
    }
  });

  test("GET /contacts/:id/provenance", async () => {
    const target = await makeContact(await owner(), { title: "Provenance check" });
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get(`/api/v1/contacts/${target.id}/provenance`);
      expect(res.status(), role).toBe(expected(role, "contact:read"));
      const fields = (await res.json()).provenance.map(
        (p: { field: string; source: string }) => `${p.field}:${p.source}`,
      );
      expect(fields).toContain("title:manual");
      expect(fields).toContain("email:manual");
    }
  });

  test("POST /contacts/bulk_create", async () => {
    for (const role of ROLES) {
      const tag = uid();
      const res = await (await apiAsRole(role)).post("/api/v1/contacts/bulk_create", {
        data: {
          contacts: [
            { firstName: "Bulk", lastName: "One", email: `bulk1-${tag}@contacts-spec.example` },
            { firstName: "Bulk", lastName: "Two", email: `bulk2-${tag}@contacts-spec.example` },
          ],
        },
      });
      expect(res.status(), role).toBe(expected(role, "contact:create"));
      if (res.ok()) {
        const body = await res.json();
        expect(body.created_contacts).toHaveLength(2);
        expect(body.existing_contacts).toHaveLength(0);
      }
    }
  });

  test("POST /contacts/bulk_update, update_stages, update_owners", async () => {
    const api0 = await owner();
    const managerId = (await makeContact(await apiAsRole("manager"))).owner?.id;
    expect(managerId).toBeTruthy();
    for (const role of ROLES) {
      const a = await makeContact(api0);
      const b = await makeContact(api0);
      const api = await apiAsRole(role);
      const bulk = await api.post("/api/v1/contacts/bulk_update", {
        data: { contactIds: [a.id, b.id], title: `Bulk ${role}`, tags: ["bulk"] },
      });
      expect(bulk.status(), `${role} bulk_update`).toBe(expected(role, "contact:update"));
      if (bulk.ok()) {
        const body = await bulk.json();
        expect(body.contacts.map((c: { title: string }) => c.title)).toEqual([`Bulk ${role}`, `Bulk ${role}`]);
      }

      const stages = await api.post("/api/v1/contacts/update_stages", {
        data: { contactIds: [a.id, b.id], stage: "contacted" },
      });
      expect(stages.status(), `${role} update_stages`).toBe(expected(role, "contact:update"));
      if (stages.ok()) {
        const body = await stages.json();
        expect(body.contacts.every((c: Contact) => c.stage === "contacted")).toBe(true);
      }

      const owners = await api.post("/api/v1/contacts/update_owners", {
        data: { contactIds: [a.id, b.id], ownerId: managerId },
      });
      expect(owners.status(), `${role} update_owners`).toBe(expected(role, "contact:update"));
      if (owners.ok()) {
        const body = await owners.json();
        expect(body.contacts.every((c: Contact) => c.owner?.id === managerId)).toBe(true);
      }
    }
  });

  test("POST /contacts/bulk_delete", async () => {
    for (const role of ROLES) {
      const a = await makeContact(await owner());
      const res = await (await apiAsRole(role)).post("/api/v1/contacts/bulk_delete", { data: { contactIds: [a.id] } });
      expect(res.status(), role).toBe(expected(role, "contact:delete"));
      if (res.ok()) expect((await res.json()).deleted).toBe(1);
    }
  });

  test("GET /contact_stages", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/contact_stages");
      expect(res.status(), role).toBe(expected(role, "contact:read"));
      const body = await res.json();
      expect(body.contact_stages.map((s: { id: string }) => s.id)).toContain("do_not_contact");
    }
  });

  test("POST /mixed_people/search with company filters", async () => {
    const api0 = await owner();
    const tag = uid();
    const big = await api0.post("/api/v1/accounts", {
      data: { name: `Mixed big ${tag}`, domain: `big-${tag}.example`, industry: `Industry ${tag}`, employeeCount: 900 },
    });
    const small = await api0.post("/api/v1/accounts", {
      data: {
        name: `Mixed small ${tag}`,
        domain: `small-${tag}.example`,
        industry: `Industry ${tag}`,
        employeeCount: 20,
      },
    });
    expect(big.status()).toBe(201);
    expect(small.status()).toBe(201);
    const inBig = await makeContact(api0, { companyId: (await big.json()).account.id, seniority: "vp" });
    await makeContact(api0, { companyId: (await small.json()).account.id, seniority: "vp" });

    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/mixed_people/search", {
        data: { industry: [`Industry ${tag}`], employeesMin: 100, seniority: ["vp"] },
      });
      expect(res.status(), role).toBe(expected(role, "search:run"));
      const body = await res.json();
      expect(body.people.map((p: Contact) => p.id)).toEqual([inBig.id]);
    }

    // Apollo parameter names work too.
    const apollo = await api0.post("/api/v1/mixed_people/search", {
      data: { person_seniorities: ["vp"], organization_num_employees_ranges: ["500,1000"], q_keywords: tag },
    });
    expect(apollo.status()).toBe(200);
    expect((await apollo.json()).people.map((p: Contact) => p.id)).toEqual([inBig.id]);
  });

  test("POST /contacts/import and GET /contacts/export", async () => {
    for (const role of ROLES) {
      const tag = uid();
      const api = await apiAsRole(role);
      const imp = await api.post("/api/v1/contacts/import", {
        multipart: {
          file: {
            name: "people.csv",
            mimeType: "text/csv",
            buffer: Buffer.from(`First name,Last name,Email\nImp,${role},imp-${tag}@contacts-spec.example\n`),
          },
        },
      });
      expect(imp.status(), `${role} import`).toBe(expected(role, "contact:import"));

      const exp = await api.get(`/api/v1/contacts/export?q=${encodeURIComponent(`imp-${tag}`)}`);
      expect(exp.status(), `${role} export`).toBe(expected(role, "contact:export"));
      if (exp.ok()) {
        expect(exp.headers()["content-type"]).toContain("text/csv");
        expect(await exp.text()).toContain(`imp-${tag}@contacts-spec.example`);
      }
    }
  });
});

test.describe("contacts: authentication and CSRF", () => {
  test("unauthenticated requests get 401 everywhere", async () => {
    const api = await anonymous();
    const id = "00000000-0000-0000-0000-000000000000";
    const calls = [
      api.post("/api/v1/contacts", { data: { email: "x@example.com" } }),
      api.post("/api/v1/contacts/search", { data: {} }),
      api.get(`/api/v1/contacts/${id}`),
      api.patch(`/api/v1/contacts/${id}`, { data: { title: "x" } }),
      api.delete(`/api/v1/contacts/${id}`),
      api.get(`/api/v1/contacts/${id}/provenance`),
      api.post("/api/v1/contacts/bulk_create", { data: { contacts: [{ email: "x@example.com" }] } }),
      api.post("/api/v1/contacts/bulk_update", { data: { contactIds: [id], title: "x" } }),
      api.post("/api/v1/contacts/bulk_delete", { data: { contactIds: [id] } }),
      api.post("/api/v1/contacts/update_owners", { data: { contactIds: [id], ownerId: id } }),
      api.post("/api/v1/contacts/update_stages", { data: { contactIds: [id], stage: "new" } }),
      api.post("/api/v1/contacts/import", { data: { csv: "email\nx@example.com" } }),
      api.get("/api/v1/contacts/export"),
      api.get("/api/v1/contact_stages"),
      api.post("/api/v1/mixed_people/search", { data: {} }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status(), res.url()).toBe(401);
  });

  test("cookie writes from another origin are refused", async () => {
    const api = await owner();
    const target = await makeContact(api);
    const evil = { origin: "https://evil.example" };
    const res = await Promise.all([
      api.post(`${BASE_URL}/api/v1/contacts`, {
        headers: evil,
        data: { email: `csrf-${uid()}@contacts-spec.example` },
      }),
      api.patch(`${BASE_URL}/api/v1/contacts/${target.id}`, { headers: evil, data: { title: "csrf" } }),
      api.delete(`${BASE_URL}/api/v1/contacts/${target.id}`, { headers: evil }),
      api.post(`${BASE_URL}/api/v1/contacts/update_stages`, {
        headers: evil,
        data: { contactIds: [target.id], stage: "replied" },
      }),
      api.post(`${BASE_URL}/api/v1/contacts/import`, { headers: evil, data: { csv: "email\na@b.example" } }),
    ]);
    for (const r of res) expect(r.status(), r.url()).toBe(403);
    const after = await (await api.get(`/api/v1/contacts/${target.id}`)).json();
    expect(after.contact.stage).toBe("new");
  });
});

test.describe("contacts: workspace isolation", () => {
  test("another workspace gets 404 on Acme ids and never sees Acme rows", async () => {
    const acme = await owner();
    const tag = uid();
    const target = await makeContact(acme, { lastName: `Isolated ${tag}` });
    const globex = await apiAs(GLOBEX_OWNER);

    expect((await globex.get(`/api/v1/contacts/${target.id}`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/contacts/${target.id}/provenance`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/contacts/${target.id}`, { data: { title: "x" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/contacts/${target.id}`)).status()).toBe(404);
    for (const path of ["bulk_update", "update_stages", "bulk_delete"]) {
      const res = await globex.post(`/api/v1/contacts/${path}`, {
        data: { contactIds: [target.id], title: "x", stage: "replied" },
      });
      expect(res.status(), path).toBe(404);
    }

    for (const path of ["/api/v1/contacts/search", "/api/v1/mixed_people/search"]) {
      const res = await globex.post(path, { data: { q: tag } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect((body.contacts ?? body.people).length, path).toBe(0);
    }
    const all = await (await globex.post("/api/v1/contacts/search", { data: { per_page: 100 } })).json();
    expect(all.contacts.some((c: Contact) => c.id === target.id)).toBe(false);
    const exported = await (await globex.get("/api/v1/contacts/export")).text();
    expect(exported).not.toContain(target.id);
    expect(exported).not.toContain(target.email as string);

    // Foreign ids in filters and writes are out of scope too.
    const acmeCompany = await (await acme.post("/api/v1/accounts/search", { data: { per_page: 1 } })).json();
    const companyId = acmeCompany.accounts[0].id;
    expect((await globex.post("/api/v1/contacts/search", { data: { companyId } })).status()).toBe(404);
    expect((await globex.post("/api/v1/contacts", { data: { email: `g-${tag}@x.example`, companyId } })).status()).toBe(
      404,
    );
    const acmeOwnerId = target.owner?.id;
    expect(acmeOwnerId).toBeTruthy();
    expect((await globex.post("/api/v1/contacts/search", { data: { ownerId: acmeOwnerId } })).status()).toBe(404);

    // And the other way round: an Acme write can't point at a Globex member.
    const globexContact = await makeContact(globex);
    expect(
      (await acme.patch(`/api/v1/contacts/${target.id}`, { data: { ownerId: globexContact.owner?.id } })).status(),
    ).toBe(404);
  });
});

test.describe("contacts: validation and dedupe", () => {
  test("invalid bodies get 422", async () => {
    const api = await owner();
    const target = await makeContact(api);
    const bad = [
      api.post("/api/v1/contacts", { data: {} }),
      api.post("/api/v1/contacts", { data: { email: "not-an-email" } }),
      api.post("/api/v1/contacts", { data: { firstName: "A", stage: "nope" } }),
      api.post("/api/v1/contacts", { data: { firstName: "A", seniority: "emperor" } }),
      api.post("/api/v1/contacts", { data: { firstName: "x".repeat(101) } }),
      api.post("/api/v1/contacts", { data: [] }),
      api.patch(`/api/v1/contacts/${target.id}`, { data: {} }),
      api.patch(`/api/v1/contacts/${target.id}`, { data: { email: "bad" } }),
      api.post("/api/v1/contacts/search", { data: { stage: ["nope"] } }),
      api.post("/api/v1/contacts/search", { data: { emailStatus: "great" } }),
      api.post("/api/v1/contacts/bulk_update", { data: { contactIds: [target.id] } }),
      api.post("/api/v1/contacts/bulk_update", { data: { contactIds: [], title: "x" } }),
      api.post("/api/v1/contacts/bulk_update", {
        data: { contactIds: Array.from({ length: 1001 }, (_, i) => `id-${i}`), title: "x" },
      }),
      api.post("/api/v1/contacts/update_stages", { data: { contactIds: [target.id], stage: "nope" } }),
      api.post("/api/v1/contacts/update_owners", { data: { contactIds: [target.id] } }),
      api.post("/api/v1/contacts/bulk_create", { data: { contacts: [] } }),
      api.post("/api/v1/contacts/bulk_create", {
        data: { contacts: Array.from({ length: 101 }, (_, i) => ({ email: `${i}@x.example` })) },
      }),
      api.post("/api/v1/contacts/bulk_create", { data: { contacts: [{ email: "bad" }] } }),
      api.post("/api/v1/contacts/import", { data: { csv: "" } }),
      api.post("/api/v1/contacts/import", { data: { csv: "colour,shape\nred,round\n" } }),
      api.post("/api/v1/contacts/import", { data: { csv: "email\n" } }),
      api.get("/api/v1/contacts/export?stage=nope"),
      api.post("/api/v1/mixed_people/search", { data: { employeesMin: -5 } }),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status(), `${res.url()} ${await res.text()}`).toBe(422);
      expect((await res.json()).error).toBeTruthy();
    }
    const malformed = await api.post("/api/v1/contacts", {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{not json"),
    });
    expect(malformed.status()).toBe(400);
  });

  test("unknown ids get 404", async () => {
    const api = await owner();
    const missing = "00000000-0000-0000-0000-000000000000";
    expect((await api.get(`/api/v1/contacts/${missing}`)).status()).toBe(404);
    expect((await api.post("/api/v1/contacts/search", { data: { listId: missing } })).status()).toBe(404);
    expect(
      (await api.post("/api/v1/contacts", { data: { email: `${uid()}@x.example`, ownerId: missing } })).status(),
    ).toBe(404);
  });

  test("emails are unique per workspace; runDedupe updates in place", async () => {
    const api = await owner();
    const tag = uid();
    const email = `dedupe-${tag}@contacts-spec.example`;
    const first = await makeContact(api, { email: email.toUpperCase() });
    expect(first.email).toBe(email);

    const dup = await api.post("/api/v1/contacts", { data: { firstName: "Dup", email } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).details.existingId).toBe(first.id);

    const merged = await api.post("/api/v1/contacts", { data: { email, title: "Merged", runDedupe: true } });
    expect(merged.status()).toBe(200);
    expect((await merged.json()).contact).toMatchObject({ id: first.id, title: "Merged" });

    const other = await makeContact(api);
    expect((await api.patch(`/api/v1/contacts/${other.id}`, { data: { email } })).status()).toBe(409);

    const bulk = await api.post("/api/v1/contacts/bulk_create", {
      data: { contacts: [{ email }, { firstName: "Fresh", email: `fresh-${tag}@contacts-spec.example` }] },
    });
    const body = await bulk.json();
    expect(body.created_contacts).toHaveLength(1);
    expect(body.existing_contacts.map((c: Contact) => c.id)).toEqual([first.id]);

    // The same email in another workspace is a different person.
    const globex = await apiAs(GLOBEX_OWNER);
    const elsewhere = await globex.post("/api/v1/contacts", { data: { email } });
    expect(elsewhere.status()).toBe(201);
  });

  test("suppressed emails and domains are flagged", async () => {
    const api = await owner();
    const tag = uid();
    // Seeded do-not-contact entries: domain competitor.example, email unsubscribed@harbor.example.
    const byDomain = await makeContact(api, { email: `someone-${tag}@competitor.example` });
    expect(byDomain.suppressed).toBe(true);
    const clean = await makeContact(api);
    expect(clean.suppressed).toBe(false);
    const search = await api.post("/api/v1/contacts/search", { data: { q: `someone-${tag}` } });
    expect((await search.json()).contacts[0].suppressed).toBe(true);
  });
});

test.describe("contacts: CSV round trip", () => {
  test("import, export, re-import updates instead of duplicating", async () => {
    const api = await owner();
    const tag = uid();
    const csv = [
      "Full name,Email,Job title,Company,Website,Tags,Seniority,Stage",
      `Ada Lovelace,ada-${tag}@rt-${tag}.example,CTO,RoundTrip ${tag},rt-${tag}.example,alpha;beta,C-Suite,replied`,
      `Alan Turing,alan-${tag}@rt-${tag}.example,Researcher,RoundTrip ${tag},rt-${tag}.example,,senior,`,
      "Broken,not-an-email,,,,,,",
      `Ada Copy,ADA-${tag}@rt-${tag}.example,,,,,,`,
      ",,,,,,,",
    ].join("\n");
    const imp = await api.post("/api/v1/contacts/import", {
      multipart: { file: { name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
    expect(imp.status(), await imp.text()).toBe(200);
    const report = await imp.json();
    expect(report).toMatchObject({ total: 4, created: 2, updated: 0, skipped: 2, companiesCreated: 1 });
    expect(report.errors).toEqual([
      { row: 4, message: expect.stringContaining("email") },
      { row: 5, message: "Duplicate of row 2." },
    ]);
    expect(report.columns).toMatchObject({ "Full name": "name", Email: "email", Website: "companyDomain" });

    const search = await (
      await api.post("/api/v1/contacts/search", { data: { q: tag, sortBy: "email", sortAscending: true } })
    ).json();
    expect(search.contacts).toHaveLength(2);
    const ada = search.contacts[0];
    expect(ada).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      seniority: "c_suite",
      stage: "replied",
      tags: ["alpha", "beta"],
      source: "csv_import",
    });
    expect(ada.company.name).toBe(`RoundTrip ${tag}`);
    expect(search.contacts[1].company.id).toBe(ada.company.id);

    const prov = await (await api.get(`/api/v1/contacts/${ada.id}/provenance`)).json();
    const fields = prov.provenance
      .filter((p: { source: string }) => p.source === "csv_import")
      .map((p: { field: string }) => p.field);
    expect(fields).toEqual(expect.arrayContaining(["firstName", "lastName", "email", "title", "seniority", "tags"]));

    const exp = await api.get(`/api/v1/contacts/export?q=${tag}&sortBy=email&sortAscending=true`);
    expect(exp.status()).toBe(200);
    expect(exp.headers()["content-disposition"]).toContain("attachment");
    const exported = await exp.text();
    const lines = exported.trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`ada-${tag}@rt-${tag}.example`);

    // Edit the export and import it back: existing people are updated, not duplicated.
    const edited = exported.replace("Researcher", "Professor");
    const again = await api.post("/api/v1/contacts/import", { data: { csv: edited } });
    expect(await again.json()).toMatchObject({ total: 2, created: 0, updated: 2, skipped: 0 });
    const alan = await (await api.post("/api/v1/contacts/search", { data: { q: `alan-${tag}` } })).json();
    expect(alan.contacts[0].title).toBe("Professor");

    // updateExisting=false skips them instead.
    const skip = await api.post("/api/v1/contacts/import?updateExisting=false", {
      headers: { "content-type": "text/csv" },
      data: edited,
    });
    expect(await skip.json()).toMatchObject({ created: 0, updated: 0, skipped: 2 });

    // Explicit header mapping overrides the guesses.
    const mapped = await api.post("/api/v1/contacts/import", {
      data: {
        csv: `Who,Mail,Notes\nGrace,grace-${tag}@rt-${tag}.example,ignore me\n`,
        mapping: { Who: "firstName", Mail: "email", Notes: null },
      },
    });
    expect(await mapped.json()).toMatchObject({
      created: 1,
      columns: { Who: "firstName", Mail: "email", Notes: null },
    });
  });

  test("export neutralises spreadsheet formulas", async () => {
    const api = await owner();
    const tag = uid();
    await makeContact(api, { title: `=HYPERLINK("x") ${tag}` });
    const text = await (await api.get(`/api/v1/contacts/export?q=${tag}`)).text();
    expect(text).toContain(`"'=HYPERLINK(""x"") ${tag}"`);
  });

  test("import rejects oversized files", async () => {
    const api = await owner();
    const rows = Array.from({ length: 5001 }, (_, i) => `r${i}@big.example`).join("\n");
    const res = await api.post("/api/v1/contacts/import", { data: { csv: `email\n${rows}` } });
    expect(res.status()).toBe(422);
    expect((await res.json()).details[0].message).toContain("5,000");
  });
});
