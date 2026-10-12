import { expect, test } from "@playwright/test";

import { can } from "../../src/lib/rbac/permissions";
import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAsRole, apiWithKey } from "../support/session";
import {
  acmeKeyClient,
  acmeOrgId,
  db,
  EVIL_ORIGIN,
  globexApi,
  globexKey,
  insertContact,
  insertEnrollment,
  uniq,
} from "./admin-helpers";

const domainFor = () => `${uniq("dnc")}.example`.toLowerCase();

async function contactState(contactId: string) {
  const { rows } = await db().query<{ stage: string }>("select stage from contact where id = $1", [contactId]);
  return rows[0]?.stage ?? null;
}
async function enrollmentState(id: string) {
  const { rows } = await db().query<{ status: string }>("select status from enrollment where id = $1", [id]);
  return rows[0]?.status ?? null;
}

test.describe("do-not-contact API", () => {
  test("list and check: every role per matrix; 401 signed out", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const list = await api.get("/api/v1/suppressions?per_page=5");
      expect(list.status(), role).toBe(expected(role, "suppression:read"));
      const check = await api.get("/api/v1/suppressions/check?email=someone@competitor.example");
      expect(check.status(), role).toBe(expected(role, "suppression:read"));
      if (check.ok()) expect((await check.json()).suppressed).toBe(true);
    }
    const anon = await anonymous();
    expect((await anon.get("/api/v1/suppressions")).status()).toBe(401);
    expect((await anon.get("/api/v1/suppressions/check?email=a@b.co")).status()).toBe(401);
    const owner = await apiAsRole("owner");
    expect((await owner.get("/api/v1/suppressions/check?email=nope")).status()).toBe(422);
    const clean = await (await owner.get(`/api/v1/suppressions/check?email=${uniq("ok")}@example.org`)).json();
    expect(clean.suppressed).toBe(false);
  });

  test("create: every role per matrix, normalised, idempotent, searchable", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/suppressions", { data: { value: `  ${domainFor().toUpperCase()} ` } });
      expect(res.status(), role).toBe(expected(role, "suppression:create", 201));
    }
    const owner = await apiAsRole("owner");
    const domain = domainFor();
    const created = await owner.post("/api/v1/suppressions", {
      data: { value: `https://www.${domain}/contact`, note: "Asked us to stop" },
    });
    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.suppression).toMatchObject({ kind: "domain", value: domain, reason: "manual" });
    const again = await owner.post("/api/v1/suppressions", { data: { value: domain.toUpperCase() } });
    expect(again.status()).toBe(200);
    expect((await again.json()).created).toBe(false);

    const email = `${uniq("Person")}@Example.ORG`;
    const emailRes = await owner.post("/api/v1/suppressions", { data: { value: email, reason: "unsubscribed" } });
    expect((await emailRes.json()).suppression).toMatchObject({ kind: "email", value: email.toLowerCase() });

    const search = await (await owner.get(`/api/v1/suppressions?q=${encodeURIComponent(domain)}`)).json();
    expect(search.suppressions.map((s: { value: string }) => s.value)).toEqual([domain]);
    expect(search.pagination.total_entries).toBe(1);

    expect((await owner.post("/api/v1/suppressions", { data: { value: "not an address" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/suppressions", { data: {} })).status()).toBe(422);
    expect(
      (await owner.post("/api/v1/suppressions", { data: { value: "a@b.co", reason: "erasure_request" } })).status(),
    ).toBe(422);
  });

  test("bulk: per matrix, dedupes, reports invalid lines, caps at 1,000", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/suppressions/bulk", { data: { text: domainFor() } });
      expect(res.status(), role).toBe(expected(role, "suppression:create"));
    }
    const owner = await apiAsRole("owner");
    const d1 = domainFor();
    const e1 = `${uniq("bulk")}@example.org`;
    const res = await owner.post("/api/v1/suppressions/bulk", {
      data: { text: `${d1}\n${e1.toUpperCase()}\n${e1}\nnot valid\n\n${d1}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 2, existing: 0 });
    expect(body.invalid).toEqual([{ line: "not valid", error: "Not a valid email address or domain." }]);
    const again = await (await owner.post("/api/v1/suppressions/bulk", { data: { values: [d1, e1] } })).json();
    expect(again).toMatchObject({ created: 0, existing: 2 });
    const tooMany = Array.from({ length: 1001 }, (_, i) => `x${i}.example`).join("\n");
    expect((await owner.post("/api/v1/suppressions/bulk", { data: { text: tooMany } })).status()).toBe(422);
    expect((await owner.post("/api/v1/suppressions/bulk", { data: { text: "  " } })).status()).toBe(422);
  });

  test("delete: every role per matrix; 404 for unknown and other workspaces", async () => {
    const owner = await apiAsRole("owner");
    for (const role of ROLES) {
      const created = await (await owner.post("/api/v1/suppressions", { data: { value: domainFor() } })).json();
      const api = await apiAsRole(role);
      const res = await api.delete(`/api/v1/suppressions/${created.suppression.id}`);
      expect(res.status(), role).toBe(expected(role, "suppression:delete"));
    }
    expect((await owner.delete(`/api/v1/suppressions/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test("suppressing stops matching contacts and their enrollments", async () => {
    const org = await acmeOrgId();
    const owner = await apiAsRole("owner");
    const domain = domainFor();
    const byDomain = await insertContact(org, { email: `ana@${domain}` });
    const byDomainEnrollment = await insertEnrollment(org, byDomain);
    const unrelated = await insertContact(org, { email: `ana@not-${domain}` });
    const unrelatedEnrollment = await insertEnrollment(org, unrelated);

    const res = await owner.post("/api/v1/suppressions", { data: { value: domain } });
    expect((await res.json()).affected).toEqual({ contacts: 1, enrollments: 1 });
    expect(await contactState(byDomain)).toBe("do_not_contact");
    expect(await enrollmentState(byDomainEnrollment)).toBe("removed");
    expect(await contactState(unrelated)).toBe("new");
    expect(await enrollmentState(unrelatedEnrollment)).toBe("active");

    const email = `${uniq("unsub")}@example.org`;
    const byEmail = await insertContact(org, { email: email.toUpperCase() });
    const byEmailEnrollment = await insertEnrollment(org, byEmail);
    await owner.post("/api/v1/suppressions", { data: { value: email, reason: "unsubscribed" } });
    expect(await contactState(byEmail)).toBe("do_not_contact");
    expect(await enrollmentState(byEmailEnrollment)).toBe("unsubscribed");

    const bulkEmail = `${uniq("bulkfx")}@example.org`;
    const bulkContact = await insertContact(org, { email: bulkEmail });
    const bulkEnrollment = await insertEnrollment(org, bulkContact);
    await owner.post("/api/v1/suppressions/bulk", { data: { values: [bulkEmail], reason: "bounced" } });
    expect(await contactState(bulkContact)).toBe("do_not_contact");
    expect(await enrollmentState(bulkEnrollment)).toBe("removed");
  });

  test("Globex isolation: lists never leak, ids are 404, side effects stay in the workspace", async () => {
    const owner = await apiAsRole("owner");
    const domain = domainFor();
    const created = await (await owner.post("/api/v1/suppressions", { data: { value: domain } })).json();
    const globex = await globexApi();
    expect((await globex.delete(`/api/v1/suppressions/${created.suppression.id}`)).status()).toBe(404);
    const list = await (await globex.get(`/api/v1/suppressions?q=${domain}`)).json();
    expect(list.suppressions).toHaveLength(0);
    expect((await (await globex.get(`/api/v1/suppressions/check?email=a@${domain}`)).json()).suppressed).toBe(false);
    const key = await apiWithKey((await globexKey()).secret);
    expect((await key.delete(`/api/v1/suppressions/${created.suppression.id}`)).status()).toBe(404);

    // A Globex suppression doesn't touch Acme contacts.
    const acmeContact = await insertContact(await acmeOrgId(), { email: `x@${domainFor()}` });
    const acmeEmail = (await db().query("select email from contact where id = $1", [acmeContact])).rows[0].email;
    await globex.post("/api/v1/suppressions", { data: { value: acmeEmail } });
    expect(await contactState(acmeContact)).toBe("new");
  });

  test("API keys: role enforced", async () => {
    const viewer = await acmeKeyClient("viewer");
    expect((await viewer.get("/api/v1/suppressions")).status()).toBe(200);
    expect((await viewer.post("/api/v1/suppressions", { data: { value: domainFor() } })).status()).toBe(403);
    const member = await acmeKeyClient("member");
    const created = await member.post("/api/v1/suppressions", { data: { value: domainFor() } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).suppression.id;
    expect((await member.delete(`/api/v1/suppressions/${id}`)).status()).toBe(403);
    const manager = await acmeKeyClient("manager");
    expect((await manager.delete(`/api/v1/suppressions/${id}`)).status()).toBe(200);
  });

  test("cross-site cookie writes are refused", async () => {
    const owner = await apiAsRole("owner");
    const headers = EVIL_ORIGIN;
    expect((await owner.post("/api/v1/suppressions", { headers, data: { value: domainFor() } })).status()).toBe(403);
    expect((await owner.post("/api/v1/suppressions/bulk", { headers, data: { text: domainFor() } })).status()).toBe(
      403,
    );
    expect((await owner.post("/api/v1/privacy/erase", { headers, data: { email: "a@b.co" } })).status()).toBe(403);
  });
});

test.describe("data-subject requests API", () => {
  test("erase: per role (contact:delete and suppression:create), validation, 401", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/privacy/erase", { data: { email: `${uniq("gone")}@example.org` } });
      const allowed = can(role, "contact:delete") && can(role, "suppression:create");
      expect(res.status(), role).toBe(allowed ? 200 : 403);
    }
    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/privacy/erase", { data: { email: "nope" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/privacy/erase", { data: {} })).status()).toBe(422);
    expect((await (await anonymous()).post("/api/v1/privacy/erase", { data: { email: "a@b.co" } })).status()).toBe(401);
  });

  test("erase deletes the person everywhere and leaves only a suppression row", async () => {
    const org = await acmeOrgId();
    const email = `${uniq("erase")}@example.org`;
    const contactId = await insertContact(org, { email, firstName: "Erin", lastName: "Erased" });
    const enrollmentId = await insertEnrollment(org, contactId);
    await db().query(
      `insert into field_provenance (id, organization_id, entity_type, entity_id, field, value, source)
       values ($1, $2, 'contact', $3, 'email', $4, 'test')`,
      [crypto.randomUUID(), org, contactId, email],
    );
    const listId = crypto.randomUUID();
    await db().query(`insert into list (id, organization_id, name, entity_type) values ($1, $2, $3, 'contact')`, [
      listId,
      org,
      uniq("list"),
    ]);
    await db().query("insert into list_member (list_id, entity_id) values ($1, $2)", [listId, contactId]);
    await db().query(
      `insert into outbound_message (id, organization_id, contact_id, to_email, subject, body, status)
       values ($1, $2, $3, $4, 'Hi', 'Hello', 'sent')`,
      [crypto.randomUUID(), org, contactId, email],
    );

    const owner = await apiAsRole("owner");
    const exported = await owner.get(`/api/v1/privacy/export?email=${encodeURIComponent(email.toUpperCase())}`);
    expect(exported.status()).toBe(200);
    const data = await exported.json();
    expect(data.contacts.map((c: { id: string }) => c.id)).toEqual([contactId]);
    expect(data.provenance).toHaveLength(1);
    expect(data.lists).toHaveLength(1);
    expect(data.enrollments).toHaveLength(1);
    expect(data.messages).toHaveLength(1);

    const res = await owner.post("/api/v1/privacy/erase", { data: { email } });
    expect(res.status()).toBe(200);
    expect((await res.json()).deleted).toMatchObject({
      contacts: 1,
      provenance: 1,
      listMemberships: 1,
      enrollments: 1,
      messages: 1,
    });

    const q = (sql: string, params: unknown[]) =>
      db()
        .query(sql, params)
        .then((r) => r.rowCount);
    expect(await q("select 1 from contact where id = $1", [contactId])).toBe(0);
    expect(await q("select 1 from enrollment where id = $1", [enrollmentId])).toBe(0);
    expect(await q("select 1 from field_provenance where entity_id = $1", [contactId])).toBe(0);
    expect(await q("select 1 from list_member where entity_id = $1", [contactId])).toBe(0);
    expect(await q("select 1 from outbound_message where lower(to_email) = $1", [email])).toBe(0);
    const { rows } = await db().query(
      "select kind, value, reason, note from suppression where organization_id = $1 and value = $2",
      [org, email],
    );
    expect(rows).toEqual([{ kind: "email", value: email, reason: "erasure_request", note: null }]);

    const after = await (await owner.get(`/api/v1/privacy/export?email=${encodeURIComponent(email)}`)).json();
    expect(after.contacts).toHaveLength(0);
    expect(after.suppressions.map((s: { reason: string }) => s.reason)).toEqual(["erasure_request"]);

    // The audit trail records the erasure without the address.
    const log = await (await owner.get("/api/v1/audit_logs?action=privacy.erase&per_page=5")).json();
    expect(JSON.stringify(log.audit_logs[0].metadata)).not.toContain(email);
  });

  test("export: per role (contact:export), validation; Globex sees nothing of Acme", async () => {
    const email = `${uniq("exp")}@example.org`;
    await insertContact(await acmeOrgId(), { email });
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.get(`/api/v1/privacy/export?email=${encodeURIComponent(email)}`);
      expect(res.status(), role).toBe(expected(role, "contact:export"));
    }
    const owner = await apiAsRole("owner");
    expect((await owner.get("/api/v1/privacy/export?email=bad")).status()).toBe(422);
    const globex = await (await (await globexApi()).get(`/api/v1/privacy/export?email=${email}`)).json();
    expect(globex.contacts).toHaveLength(0);
    const key = await acmeKeyClient("viewer");
    expect((await key.get(`/api/v1/privacy/export?email=${email}`)).status()).toBe(403);
  });
});
