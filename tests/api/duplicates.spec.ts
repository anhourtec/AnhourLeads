import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { pg, uniq } from "./_engage";
import { insertCompany, insertList, insertNote, insertPerson, insertTask } from "./_wp-e-enrichment";

/** Duplicates: detection and merge (the richer record survives with everything linked to the other). */

test.describe.configure({ timeout: 120_000 });

interface Group {
  entityType: string;
  reason: string;
  keepId: string;
  records: Array<{ id: string }>;
}

async function contactPair() {
  const tag = uniq("dup");
  const companyId = await insertCompany("acme", { name: `Dup Co ${tag}` });
  const rich = await insertPerson("acme", {
    firstName: "Dana",
    lastName: tag,
    companyId,
    email: `${tag}@dup.example.test`,
    title: "Head of sales",
    phone: "+1 555 0100",
    linkedinUrl: "https://www.linkedin.com/in/dana-dup",
  });
  const poor = await insertPerson("acme", { firstName: "Dana", lastName: tag, companyId, city: "Lisbon" });
  return { rich, poor, companyId };
}

test.describe("duplicates: role matrix", () => {
  test("GET /duplicates", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/duplicates");
      expect(res.status(), role).toBe(expected(role, "contact:read"));
    }
  });

  test("POST /duplicates/merge", async () => {
    for (const role of ROLES) {
      const { rich, poor } = await contactPair();
      const res = await (await apiAsRole(role)).post("/api/v1/duplicates/merge", {
        data: { entityType: "contact", ids: [rich, poor] },
      });
      expect(res.status(), role).toBe(expected(role, "contact:delete"));
    }
  });
});

test.describe("duplicates: auth, validation, isolation, CSRF", () => {
  test("401, 422, 404 across workspaces, 403 cross-site", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/duplicates")).status()).toBe(401);
    expect((await anon.post("/api/v1/duplicates/merge", { data: {} })).status()).toBe(401);

    const api = await apiAsRole("manager");
    const { rich, poor } = await contactPair();
    for (const data of [
      { entityType: "contact", ids: [rich] },
      { entityType: "contact", ids: [rich, rich] },
      { entityType: "contact", ids: [rich, poor], keepId: "other" },
      { entityType: "deal", ids: [rich, poor] },
    ]) {
      expect((await api.post("/api/v1/duplicates/merge", { data })).status(), JSON.stringify(data)).toBe(422);
    }

    const globex = await apiAs(GLOBEX_OWNER);
    const steal = await globex.post("/api/v1/duplicates/merge", { data: { entityType: "contact", ids: [rich, poor] } });
    expect(steal.status()).toBe(404);
    const groups = (await (await globex.get("/api/v1/duplicates")).json()).duplicates as Group[];
    expect(groups.some((g) => g.records.some((r) => r.id === rich))).toBe(false);

    const evil = await api.post(`${BASE_URL}/api/v1/duplicates/merge`, {
      headers: { origin: "https://evil.example" },
      data: { entityType: "contact", ids: [rich, poor] },
    });
    expect(evil.status()).toBe(403);
  });
});

test.describe("duplicates: merge behaviour", () => {
  test("contacts: the richer record is kept and gains the other's lists, tasks, notes and empty fields", async () => {
    const { rich, poor } = await contactPair();
    const listId = await insertList("acme", "contact", [poor]);
    const taskId = await insertTask("acme", poor);
    const noteId = await insertNote("acme", "contact", poor);

    const api = await apiAsRole("manager");
    const groups = (await (await api.get("/api/v1/duplicates")).json()).duplicates as Group[];
    const group = groups.find((g) => g.records.some((r) => r.id === poor));
    expect(group?.reason).toBe("same_name_and_company");
    expect(group?.keepId).toBe(rich);

    const res = await api.post("/api/v1/duplicates/merge", { data: { entityType: "contact", ids: [poor, rich] } });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.keptId).toBe(rich);
    expect(body.mergedIds).toEqual([poor]);

    expect((await api.get(`/api/v1/contacts/${poor}`)).status()).toBe(404);
    expect((await api.get(`/api/v1/contacts/${rich}`)).status()).toBe(200);
    const db = pg();
    expect(
      (await db.query("select 1 from list_member where list_id = $1 and entity_id = $2", [listId, rich])).rowCount,
    ).toBe(1);
    expect((await db.query("select 1 from list_member where entity_id = $1", [poor])).rowCount).toBe(0);
    expect(
      (await db.query<{ contact_id: string }>("select contact_id from task where id = $1", [taskId])).rows[0]
        ?.contact_id,
    ).toBe(rich);
    expect(
      (await db.query<{ entity_id: string }>("select entity_id from note where id = $1", [noteId])).rows[0]?.entity_id,
    ).toBe(rich);
    const kept = (
      await db.query<{ city: string; title: string }>("select city, title from contact where id = $1", [rich])
    ).rows[0];
    expect(kept?.city).toBe("Lisbon");
    expect(kept?.title).toBe("Head of sales");
    const audit = await db.query("select 1 from audit_log where action = 'contact.merge' and entity_id = $1", [rich]);
    expect(audit.rowCount).toBe(1);
  });

  test("companies with the same domain merge and keep their contacts", async () => {
    const tag = uniq("dupco");
    const rich = await insertCompany("acme", { name: `Same ${tag}`, domain: `${tag}.test`, industry: "Software" });
    const poor = await insertCompany("acme", { name: `Same ${tag} Inc`, domain: `www.${tag}.test` });
    const person = await insertPerson("acme", { firstName: "Moved", lastName: tag, companyId: poor });

    const api = await apiAsRole("admin");
    const groups = (await (await api.get("/api/v1/duplicates")).json()).duplicates as Group[];
    expect(groups.find((g) => g.records.some((r) => r.id === poor))?.reason).toBe("same_domain");
    const res = await api.post("/api/v1/duplicates/merge", { data: { entityType: "company", ids: [rich, poor] } });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).keptId).toBe(rich);
    expect((await api.get(`/api/v1/accounts/${poor}`)).status()).toBe(404);
    const moved = await pg().query<{ company_id: string }>("select company_id from contact where id = $1", [person]);
    expect(moved.rows[0]?.company_id).toBe(rich);
  });
});
