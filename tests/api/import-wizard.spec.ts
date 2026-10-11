import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { orgId, pg, uniq } from "./_engage";

/**
 * Import wizard: preview, sample template and the import pipeline (mapping incl. custom fields,
 * stage, update/skip, account auto-assignment, lists, batch provenance) for contacts and accounts.
 */

test.describe.configure({ timeout: 120_000 });

const owner = () => apiAsRole("owner");

function csvFile(name: string, body: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(body) };
}

async function importContacts(
  api: APIRequestContext,
  csv: string,
  extra: { mapping?: Record<string, string | null>; settings?: Record<string, unknown> } = {},
) {
  return api.post("/api/v1/contacts/import", {
    multipart: {
      file: csvFile("people.csv", csv),
      ...(extra.mapping ? { mapping: JSON.stringify(extra.mapping) } : {}),
      ...(extra.settings ? { settings: JSON.stringify(extra.settings) } : {}),
    },
  });
}

async function contactByEmail(email: string) {
  const { rows } = await pg().query<{
    id: string;
    stage: string;
    title: string | null;
    company_id: string | null;
    custom_fields: Record<string, unknown>;
    organization_id: string;
  }>("select id, stage, title, company_id, custom_fields, organization_id from contact where email = $1", [email]);
  return rows[0];
}

async function customField(slug: "acme" | "globex", entity: "contact" | "company", type = "number") {
  const key = uniq("cf").replace(/-/g, "_");
  await pg().query(
    "insert into custom_field (id, organization_id, entity_type, key, label, type, position) values (gen_random_uuid()::text, $1, $2, $3, $4, $5, 0)",
    [await orgId(slug), entity, key, `Score ${key}`, type],
  );
  return key;
}

async function staticList(api: APIRequestContext, entityType: "contact" | "company") {
  const res = await api.post("/api/v1/labels", { data: { name: uniq("imp-list"), entityType } });
  expect(res.status()).toBe(201);
  return (await res.json()).label as { id: string; name: string };
}

async function listMembers(listId: string): Promise<string[]> {
  const { rows } = await pg().query<{ entity_id: string }>("select entity_id from list_member where list_id = $1", [
    listId,
  ]);
  return rows.map((r) => r.entity_id);
}

test.describe("import wizard: role matrix", () => {
  test("preview, template and import for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const tag = uniq(role);
      const people = `First name,Email,Notes\nRole,${tag}@iw-matrix.example,x\n`;
      const accounts = `Company name,Website\nRoleCo ${tag},${tag}.iw-matrix.example\n`;

      const cPreview = await api.post("/api/v1/contacts/import/preview", {
        multipart: { file: csvFile("p.csv", people) },
      });
      expect(cPreview.status(), `${role} contact preview`).toBe(expected(role, "contact:import"));
      const aPreview = await api.post("/api/v1/accounts/import/preview", { data: { csv: accounts } });
      expect(aPreview.status(), `${role} account preview`).toBe(expected(role, "company:import"));

      const cTemplate = await api.get("/api/v1/contacts/import/template");
      expect(cTemplate.status(), `${role} contact template`).toBe(expected(role, "contact:import"));
      const aTemplate = await api.get("/api/v1/accounts/import/template");
      expect(aTemplate.status(), `${role} account template`).toBe(expected(role, "company:import"));

      const cImport = await importContacts(api, people, { settings: { ifExists: "update" } });
      expect(cImport.status(), `${role} contact import`).toBe(expected(role, "contact:import"));
      const aImport = await api.post("/api/v1/accounts/import", {
        data: { csv: accounts, settings: { stageMode: "csv" } },
      });
      expect(aImport.status(), `${role} account import`).toBe(expected(role, "company:import"));
    }
  });

  test("preview recognises columns and lists custom fields", async () => {
    const api = await owner();
    const key = await customField("acme", "contact");
    const csv = `First Name,Last Name,Email Address,Score ${key},Favourite colour\nAda,Lovelace,ada@example.com,7,blue\n,,,,\n`;
    const res = await api.post("/api/v1/contacts/import/preview", { data: { csv } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.rows).toBe(1);
    expect(body.columns).toEqual([
      { header: "First Name", field: "firstName", recognised: true, samples: ["Ada"] },
      { header: "Last Name", field: "lastName", recognised: true, samples: ["Lovelace"] },
      { header: "Email Address", field: "email", recognised: true, samples: ["ada@example.com"] },
      { header: `Score ${key}`, field: `cf.${key}`, recognised: true, samples: ["7"] },
      { header: "Favourite colour", field: null, recognised: false, samples: ["blue"] },
    ]);
    const values = body.fields.map((f: { value: string }) => f.value);
    expect(values).toEqual(expect.arrayContaining(["email", "companyName", `cf.${key}`]));
    expect(body.fields.find((f: { value: string }) => f.value === `cf.${key}`).group).toBe("Custom fields");
  });

  test("templates are CSV attachments that import cleanly", async () => {
    const api = await owner();
    const res = await api.get("/api/v1/contacts/import/template");
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const preview = await (
      await api.post("/api/v1/contacts/import/preview", { data: { csv: await res.text() } })
    ).json();
    expect(preview.columns.every((c: { recognised: boolean }) => c.recognised)).toBe(true);
    const accounts = await api.get("/api/v1/accounts/import/template");
    const aPreview = await (
      await api.post("/api/v1/accounts/import/preview", { data: { csv: await accounts.text() } })
    ).json();
    expect(aPreview.columns.every((c: { recognised: boolean }) => c.recognised)).toBe(true);
  });
});

test.describe("import wizard: auth, CSRF, validation, isolation", () => {
  test("anonymous requests get 401", async () => {
    const api = await anonymous();
    expect((await api.post("/api/v1/contacts/import/preview", { data: { csv: "email\na@b.example" } })).status()).toBe(
      401,
    );
    expect((await api.get("/api/v1/contacts/import/template")).status()).toBe(401);
    expect((await api.post("/api/v1/accounts/import/preview", { data: { csv: "name\nx" } })).status()).toBe(401);
    expect((await api.get("/api/v1/accounts/import/template")).status()).toBe(401);
    expect((await api.post("/api/v1/contacts/import", { data: { csv: "email\na@b.example" } })).status()).toBe(401);
  });

  test("cross-site cookie writes get 403", async () => {
    const api = await owner();
    const evil = { origin: "https://evil.example" };
    for (const path of [
      "/api/v1/contacts/import/preview",
      "/api/v1/accounts/import/preview",
      "/api/v1/contacts/import",
      "/api/v1/accounts/import",
    ]) {
      const res = await api.post(`${BASE_URL}${path}`, {
        headers: evil,
        data: { csv: "name,email\nx,x@evil.example" },
      });
      expect(res.status(), path).toBe(403);
    }
  });

  test("bad mapping, stage, settings and empty files get 422", async () => {
    const api = await owner();
    const bad = await Promise.all([
      importContacts(api, "Email\na@iw-bad.example\n", { mapping: { Email: "notAField" } }),
      importContacts(api, "Email\na@iw-bad.example\n", { settings: { stageMode: "fixed", stage: "nope" } }),
      importContacts(api, "Email\na@iw-bad.example\n", { settings: { stageMode: "fixed" } }),
      importContacts(api, "Email\na@iw-bad.example\n", { settings: { ifExists: "merge" } }),
      importContacts(api, "Email\na@iw-bad.example\n", { settings: { listId: "x", newListName: "y" } }),
      api.post("/api/v1/accounts/import", {
        data: { csv: "Name\nX", settings: { stageMode: "fixed", stage: "replied" } },
      }),
      api.post("/api/v1/accounts/import", {
        data: { csv: "Name\nX", settings: { enrichment: { verifyEmails: true } } },
      }),
      api.post("/api/v1/contacts/import/preview", { data: { csv: "email\n" } }),
      api.post("/api/v1/contacts/import", { multipart: { file: csvFile("empty.csv", "") } }),
    ]);
    for (const res of bad) {
      expect(res.status(), await res.text()).toBe(422);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  test("another workspace's list is not found, and imported records never leak", async () => {
    const acmeList = await staticList(await owner(), "contact");
    const globex = await apiAs(GLOBEX_OWNER);
    const tag = uniq("iso");
    const res = await importContacts(globex, `Email\n${tag}@iw-iso.example\n`, { settings: { listId: acmeList.id } });
    expect(res.status()).toBe(404);
    expect(await contactByEmail(`${tag}@iw-iso.example`)).toBeUndefined();

    const acme = await importContacts(await owner(), `Email,First name\n${tag}@iw-iso.example,Iso\n`);
    expect(acme.status()).toBe(200);
    const search = await (await globex.post("/api/v1/contacts/search", { data: { q: tag } })).json();
    expect(search.contacts).toHaveLength(0);
    const batches = await pg().query(
      "select 1 from audit_log where organization_id = $1 and metadata->>'batchId' = $2",
      [await orgId("globex"), (await acme.json()).batchId],
    );
    expect(batches.rowCount).toBe(0);
  });
});

test.describe("import wizard: pipeline", () => {
  test("custom fields, don't-import columns and batch provenance", async () => {
    const api = await owner();
    const key = await customField("acme", "contact");
    const tag = uniq("cfi");
    const csv = [
      `Email,Title,Score,Secret notes`,
      `a-${tag}@iw-cf.example,Analyst,42,do not import`,
      `b-${tag}@iw-cf.example,Engineer,not a number,x`,
    ].join("\n");
    const res = await importContacts(api, csv, {
      mapping: { Score: `cf.${key}`, "Secret notes": null },
      settings: { fileName: `wizard-${tag}.csv` },
    });
    expect(res.status(), await res.text()).toBe(200);
    const report = await res.json();
    expect(report).toMatchObject({ total: 2, created: 1, skipped: 1 });
    expect(report.columns).toMatchObject({ Score: `cf.${key}`, "Secret notes": null, Email: "email" });
    expect(report.errors).toEqual([{ row: 3, message: expect.stringContaining("must be a number") }]);
    expect(report.batchId).toMatch(/^[0-9a-f-]{36}$/);

    const created = await contactByEmail(`a-${tag}@iw-cf.example`);
    expect(created.custom_fields).toEqual({ [key]: 42 });
    const prov = await pg().query<{ field: string; source: string }>(
      "select field, source from field_provenance where entity_id = $1 and source_url = $2",
      [created.id, `import:${report.batchId}`],
    );
    expect(prov.rows.map((r) => r.field)).toEqual(expect.arrayContaining(["email", "title", `cf.${key}`]));
    expect(prov.rows.every((r) => r.source === "csv_import")).toBe(true);
    expect(prov.rows.map((r) => r.field)).not.toContain("Secret notes");

    const audit = await pg().query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_log where action = 'contact.import' and metadata->>'batchId' = $1",
      [report.batchId],
    );
    expect(audit.rows[0].metadata).toMatchObject({ fileName: `wizard-${tag}.csv`, created: 1, skipped: 1 });
  });

  test("fixed stage, update versus skip", async () => {
    const api = await owner();
    const tag = uniq("stg");
    const email = `s-${tag}@iw-stage.example`;
    const first = await importContacts(api, `Email,Title,Stage\n${email},Buyer,replied\n`, {
      settings: { stageMode: "fixed", stage: "interested" },
    });
    expect(await first.json()).toMatchObject({ created: 1 });
    expect((await contactByEmail(email)).stage).toBe("interested");

    const skip = await importContacts(api, `Email,Title\n${email},Changed\n`, { settings: { ifExists: "skip" } });
    expect(await skip.json()).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect((await contactByEmail(email)).title).toBe("Buyer");

    const update = await importContacts(api, `Email,Title\n${email},Changed\n`, { settings: { ifExists: "update" } });
    expect(await update.json()).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect((await contactByEmail(email)).title).toBe("Changed");
  });

  test("accounts are assigned from the email domain, never from free mail", async () => {
    const api = await owner();
    const tag = uniq("dom");
    const domain = `${tag}.iw-auto.example`;
    const res = await importContacts(api, `Email,First name\nworker@${domain},Worker\nperson-${tag}@gmail.com,Free\n`);
    const report = await res.json();
    expect(report).toMatchObject({ created: 2, companiesCreated: 1 });
    const worker = await contactByEmail(`worker@${domain}`);
    const { rows } = await pg().query<{ domain: string }>("select domain from company where id = $1", [
      worker.company_id,
    ]);
    expect(rows[0].domain).toBe(domain);
    expect((await contactByEmail(`person-${tag}@gmail.com`)).company_id).toBeNull();

    const off = await importContacts(api, `Email,Company\nother@${tag}-off.iw-auto.example,Off Co ${tag}\n`, {
      settings: { autoAssignAccounts: false },
    });
    expect(await off.json()).toMatchObject({ created: 1, companiesCreated: 0 });
    expect((await contactByEmail(`other@${tag}-off.iw-auto.example`)).company_id).toBeNull();
  });

  test("records go into an existing list or a new one", async () => {
    const api = await owner();
    const tag = uniq("lst");
    const existing = await staticList(api, "contact");
    const res = await importContacts(api, `Email\na-${tag}@iw-list.example\nb-${tag}@iw-list.example\n`, {
      settings: { listId: existing.id },
    });
    const report = await res.json();
    expect(report).toMatchObject({ created: 2, listId: existing.id });
    const a = await contactByEmail(`a-${tag}@iw-list.example`);
    const b = await contactByEmail(`b-${tag}@iw-list.example`);
    expect((await listMembers(existing.id)).sort()).toEqual([a.id, b.id].sort());

    // Updated records join the new list too.
    const name = `New list ${tag}`;
    const again = await importContacts(
      api,
      `Email,Title\na-${tag}@iw-list.example,Lead\nc-${tag}@iw-list.example,New\n`,
      {
        settings: { newListName: name },
      },
    );
    const second = await again.json();
    expect(second).toMatchObject({ created: 1, updated: 1, listName: name });
    expect(await listMembers(second.listId)).toHaveLength(2);
    const { rows } = await pg().query<{ kind: string; entity_type: string }>(
      "select kind, entity_type from list where id = $1",
      [second.listId],
    );
    expect(rows[0]).toEqual({ kind: "static", entity_type: "contact" });

    // A company list is refused for people.
    const companyList = await staticList(api, "company");
    const wrong = await importContacts(api, `Email\nz-${tag}@iw-list.example\n`, {
      settings: { listId: companyList.id },
    });
    expect(wrong.status()).toBe(422);
  });

  test("created people get a timeline row after the import", async () => {
    const api = await owner();
    const tag = uniq("evt");
    const res = await importContacts(api, `Email,First name\nev-${tag}@iw-evt.example,Eve\n`);
    expect(res.status()).toBe(200);
    const contact = await contactByEmail(`ev-${tag}@iw-evt.example`);
    await expect
      .poll(
        async () =>
          (await pg().query("select 1 from activity where contact_id = $1 and type = 'contact_created'", [contact.id]))
            .rowCount,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test("accounts: custom fields, fixed stage and a list", async () => {
    const api = await owner();
    const key = await customField("acme", "company", "picklist");
    await pg().query("update custom_field set options = $1 where key = $2", [["Gold", "Silver"], key]);
    const list = await staticList(api, "company");
    const tag = uniq("acc");
    const csv = `Company name,Website,Tier\nGold ${tag},${tag}-g.iw-acc.example,gold\nBad ${tag},${tag}-b.iw-acc.example,bronze\n`;
    const res = await api.post("/api/v1/accounts/import", {
      data: {
        csv,
        mapping: { Tier: `cf.${key}` },
        settings: { stageMode: "fixed", stage: "prospect", listId: list.id },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const report = await res.json();
    expect(report).toMatchObject({ created: 1, skipped: 1, listId: list.id });
    expect(report.errors[0].message).toContain("must be one of");
    const { rows } = await pg().query<{ id: string; stage: string; custom_fields: Record<string, unknown> }>(
      "select id, stage, custom_fields from company where domain = $1",
      [`${tag}-g.iw-acc.example`],
    );
    expect(rows[0]).toMatchObject({ stage: "prospect", custom_fields: { [key]: "Gold" } });
    expect(await listMembers(list.id)).toEqual([rows[0].id]);
  });

  test("enrichment after import is queued for people without an email", async () => {
    const api = await apiAsRole("member");
    const tag = uniq("enr");
    const res = await importContacts(
      api,
      `First name,Last name,Company,Website\nNo,Email ${tag},Enr ${tag},${tag}.iw-enr.example\n`,
      {
        settings: { enrichment: { findMissingEmails: true } },
      },
    );
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, enrichmentQueued: 1 });
  });
});
