import { type APIRequestContext, expect, test } from "@playwright/test";

import { type FixtureServer, startFixtureServer } from "../support/fixture-server";
import { expected, ROLES } from "../support/matrix";
import { callsWithKey, type ProviderMock, providerCalls, startProviderMock } from "../support/provider-mock";
import { anonymous, apiAsRole, apiWithKey } from "../support/session";
import {
  acmeKey,
  acmeOrgId,
  db,
  EVIL_ORIGIN,
  freshWorkspace,
  globexApi,
  globexKey,
  insertContact,
  uniq,
} from "./admin-helpers";

/**
 * Bring-your-own data providers: the workspace's own keys for People Data Labs, Apollo and Hunter.
 * Every provider call goes to the local mock (tests/support/provider-mock.ts), never a real provider.
 * Acme rows are created disabled so other specs' enrichment never reaches the mock.
 */

let mock: ProviderMock;
let fixture: FixtureServer;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mock = await startProviderMock();
  fixture = await startFixtureServer();
});

test.afterAll(async () => {
  await mock.close();
  await fixture.close();
});

const fakeKey = (tag: string) => `${tag}-${uniq("k").replace(/[^a-z0-9-]/gi, "")}`;

async function auditText(api: APIRequestContext, id: string): Promise<string> {
  const res = await api.get(`/api/v1/audit_logs?entityId=${id}&per_page=100`);
  expect(res.status()).toBe(200);
  return res.text();
}

async function acmeHunter(owner: APIRequestContext, key: string) {
  const res = await owner.post("/api/v1/data_providers", { data: { provider: "hunter", apiKey: key, enabled: false } });
  expect([200, 201]).toContain(res.status());
  return (await res.json()).data_provider as { id: string; keyHint: string; enabled: boolean };
}

test.describe("data providers API", () => {
  test("every endpoint per role; the key is never returned or audited", async () => {
    const owner = await apiAsRole("owner");
    const key = fakeKey("good");
    const row = await acmeHunter(owner, key);
    expect(row.keyHint).toBe(key.slice(-4));
    expect(row.enabled).toBe(false);
    const stored = await db().query<{ api_key_enc: string }>("select api_key_enc from data_provider where id = $1", [
      row.id,
    ]);
    expect(stored.rows[0].api_key_enc).not.toContain(key);

    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const list = await api.get("/api/v1/data_providers");
      expect(list.status(), `list ${role}`).toBe(expected(role, "provider:manage"));
      if (list.ok()) {
        const text = await list.text();
        expect(text).not.toContain(key);
        const found = JSON.parse(text).data_providers.find((p: { id: string }) => p.id === row.id);
        expect(Object.keys(found).sort()).toEqual(
          ["createdAt", "createdBy", "enabled", "id", "keyHint", "lastError", "lastUsedAt", "provider"].sort(),
        );
      }

      const replacement = fakeKey(`good-${role}`);
      const save = await api.post("/api/v1/data_providers", {
        data: { provider: "hunter", apiKey: replacement, enabled: false },
      });
      expect(save.status(), `save ${role}`).toBe(expected(role, "provider:manage"));
      if (save.ok()) expect(await save.text()).not.toContain(replacement);

      const patch = await api.patch(`/api/v1/data_providers/${row.id}`, { data: { enabled: false } });
      expect(patch.status(), `patch ${role}`).toBe(expected(role, "provider:manage"));

      const probe = await api.post(`/api/v1/data_providers/${row.id}/test`);
      expect(probe.status(), `test ${role}`).toBe(expected(role, "provider:manage"));
      if (probe.ok()) expect((await probe.json()).ok).toBe(true);
    }

    // Delete per role: each role tries to remove a fresh row; only owner and admin may.
    const removed: string[] = [];
    for (const role of ROLES) {
      const target = await acmeHunter(owner, fakeKey("good"));
      removed.push(target.id);
      const res = await (await apiAsRole(role)).delete(`/api/v1/data_providers/${target.id}`);
      expect(res.status(), `delete ${role}`).toBe(expected(role, "provider:manage"));
      if (!res.ok()) await owner.delete(`/api/v1/data_providers/${target.id}`);
    }

    const last = await acmeHunter(owner, key);
    const audit = await auditText(owner, last.id);
    expect(audit).toContain("provider.connect");
    expect(await auditText(owner, removed[0])).toContain("provider.delete");
    expect(await auditText(owner, row.id)).toContain("provider.key_replace");
    expect(audit).not.toContain(key);
    const { rows } = await db().query<{ metadata: unknown }>(
      "select metadata from audit_log where entity_type = 'data_provider' and organization_id = $1",
      [await acmeOrgId()],
    );
    expect(JSON.stringify(rows)).not.toContain(key);
    await owner.delete(`/api/v1/data_providers/${last.id}`);
  });

  test("unauthenticated is 401; API keys follow their role and skip CSRF", async () => {
    const anon = await anonymous();
    const id = crypto.randomUUID();
    expect((await anon.get("/api/v1/data_providers")).status()).toBe(401);
    expect(
      (await anon.post("/api/v1/data_providers", { data: { provider: "hunter", apiKey: "x".repeat(10) } })).status(),
    ).toBe(401);
    expect((await anon.patch(`/api/v1/data_providers/${id}`, { data: { enabled: true } })).status()).toBe(401);
    expect((await anon.delete(`/api/v1/data_providers/${id}`)).status()).toBe(401);
    expect((await anon.post(`/api/v1/data_providers/${id}/test`)).status()).toBe(401);

    const owner = await apiAsRole("owner");
    const row = await acmeHunter(owner, fakeKey("good"));
    for (const role of ROLES) {
      const client = await apiWithKey((await acmeKey(role)).secret);
      expect((await client.get("/api/v1/data_providers")).status(), role).toBe(expected(role, "provider:manage"));
      const patch = await client.patch(`/api/v1/data_providers/${row.id}`, { data: { enabled: false } });
      expect(patch.status(), role).toBe(expected(role, "provider:manage"));
    }
    await owner.delete(`/api/v1/data_providers/${row.id}`);
  });

  test("Globex can't see or touch Acme's provider; unknown ids are 404", async () => {
    const owner = await apiAsRole("owner");
    const row = await acmeHunter(owner, fakeKey("good"));
    const globex = await globexApi();
    const list = await (await globex.get("/api/v1/data_providers")).json();
    expect(list.data_providers.some((p: { id: string }) => p.id === row.id)).toBe(false);
    expect((await globex.patch(`/api/v1/data_providers/${row.id}`, { data: { enabled: true } })).status()).toBe(404);
    expect((await globex.post(`/api/v1/data_providers/${row.id}/test`)).status()).toBe(404);
    expect((await globex.delete(`/api/v1/data_providers/${row.id}`)).status()).toBe(404);
    const globexClient = await apiWithKey((await globexKey()).secret);
    expect((await globexClient.delete(`/api/v1/data_providers/${row.id}`)).status()).toBe(404);
    const still = await db().query("select 1 from data_provider where id = $1 and enabled = false", [row.id]);
    expect(still.rowCount).toBe(1);
    expect(
      (await owner.patch(`/api/v1/data_providers/${crypto.randomUUID()}`, { data: { enabled: true } })).status(),
    ).toBe(404);
    await owner.delete(`/api/v1/data_providers/${row.id}`);
  });

  test("validation errors are 422; cross-site cookie writes are 403", async () => {
    const owner = await apiAsRole("owner");
    const bad = [
      {},
      { provider: "clearbit", apiKey: "abcdefghijk" },
      { provider: "hunter" },
      { provider: "hunter", apiKey: "short" },
      { provider: "hunter", apiKey: "has spaces in it" },
      { provider: "hunter", apiKey: "abcdefghijk", extra: true },
    ];
    for (const data of bad) {
      expect((await owner.post("/api/v1/data_providers", { data })).status(), JSON.stringify(data)).toBe(422);
    }
    const row = await acmeHunter(owner, fakeKey("good"));
    expect((await owner.patch(`/api/v1/data_providers/${row.id}`, { data: { enabled: "yes" } })).status()).toBe(422);
    expect((await owner.patch(`/api/v1/data_providers/${row.id}`, { data: {} })).status()).toBe(422);

    const post = await owner.post("/api/v1/data_providers", {
      headers: EVIL_ORIGIN,
      data: { provider: "hunter", apiKey: fakeKey("good") },
    });
    expect(post.status()).toBe(403);
    expect(
      (
        await owner.patch(`/api/v1/data_providers/${row.id}`, { headers: EVIL_ORIGIN, data: { enabled: true } })
      ).status(),
    ).toBe(403);
    expect((await owner.post(`/api/v1/data_providers/${row.id}/test`, { headers: EVIL_ORIGIN })).status()).toBe(403);
    expect((await owner.delete(`/api/v1/data_providers/${row.id}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
    await owner.delete(`/api/v1/data_providers/${row.id}`);
  });

  test("connection test: works, rejected key and no credits are stored as plain errors", async () => {
    const ws = await freshWorkspace();
    const api = ws.api;
    for (const provider of ["people_data_labs", "apollo", "hunter"] as const) {
      const good = fakeKey("good");
      const from = providerCalls.length;
      const saved = await api.post("/api/v1/data_providers", { data: { provider, apiKey: good, enabled: false } });
      expect(saved.status(), provider).toBe(201);
      const id = (await saved.json()).data_provider.id;
      const ok = await (await api.post(`/api/v1/data_providers/${id}/test`)).json();
      expect(ok, provider).toMatchObject({ ok: true, error: null });
      const paths = callsWithKey(good, from).map((c) => c.path);
      expect(paths, provider).toEqual([
        { people_data_labs: "/v5/autocomplete", apollo: "/api/v1/auth/health", hunter: "/v2/account" }[provider],
      ]);

      const bad = fakeKey("bad");
      expect((await api.post("/api/v1/data_providers", { data: { provider, apiKey: bad } })).status()).toBe(200);
      const rejected = await (await api.post(`/api/v1/data_providers/${id}/test`)).json();
      expect(rejected.ok).toBe(false);
      expect(rejected.error).toMatch(/rejected the API key/);
      expect(rejected.data_provider.lastError).toBe(rejected.error);
      expect(JSON.stringify(rejected)).not.toContain(bad);

      await api.post("/api/v1/data_providers", { data: { provider, apiKey: fakeKey("broke") } });
      const broke = await (await api.post(`/api/v1/data_providers/${id}/test`)).json();
      expect(broke.error, provider).toMatch(/no credits/);
    }
  });

  test("enrichment fills only empty fields from enabled providers, with provenance", async () => {
    test.setTimeout(120_000);
    const ws = await freshWorkspace();
    const api = ws.api;
    const domain = `${uniq("acme").toLowerCase()}.example`;
    const companyId = crypto.randomUUID();
    await db().query(
      "insert into company (id, organization_id, name, domain, source) values ($1, $2, 'Provider Test Co', $3, 'test')",
      [companyId, ws.organizationId, domain],
    );
    const pdlKey = fakeKey("good-pdl");
    const apolloKey = fakeKey("good-apollo");
    const pdl = await (
      await api.post("/api/v1/data_providers", { data: { provider: "people_data_labs", apiKey: pdlKey } })
    ).json();
    await api.post("/api/v1/data_providers", { data: { provider: "apollo", apiKey: apolloKey, enabled: false } });

    // A contact with an address but no title or phone: both are filled, the address is kept.
    const withEmail = await insertContact(ws.organizationId, {
      firstName: "Riley",
      lastName: "Stone",
      email: `riley@${domain}`,
      companyId,
    });
    const from = providerCalls.length;
    const res = await api.post("/api/v1/people/match", { data: { contactId: withEmail, verify: false } });
    expect(res.status(), await res.text()).toBe(200);
    const match = await res.json();
    expect(match.person.providers).toEqual(["people_data_labs"]);
    const {
      rows: [c1],
    } = await db().query("select email, title, phone, seniority, linkedin_url, city from contact where id = $1", [
      withEmail,
    ]);
    expect(c1).toMatchObject({
      email: `riley@${domain}`,
      title: "Head of Growth",
      phone: "+1 555 0100",
      seniority: "director",
      linkedin_url: "https://www.linkedin.com/in/riley-stone-mock",
      city: "Austin",
    });
    const prov = match.person.provenance as Array<{ field: string; source: string }>;
    for (const field of ["title", "phone", "linkedinUrl"]) {
      expect(prov.find((p) => p.field === field)?.source, field).toBe("provider:people_data_labs");
    }
    expect(prov.find((p) => p.field === "email")).toBeUndefined();
    // The disabled provider (Apollo) was never called.
    expect(callsWithKey(apolloKey)).toEqual([]);
    expect(callsWithKey(pdlKey, from).map((c) => c.path)).toEqual(["/v5/person/enrich"]);

    // A contact with a title someone typed keeps it; only the empty fields are filled.
    const typed = await insertContact(ws.organizationId, {
      firstName: "Sam",
      lastName: "Lee",
      email: `sam@${domain}`,
      companyId,
    });
    await db().query("update contact set title = 'Chief Tinkerer', phone = '+44 20 0000' where id = $1", [typed]);
    await api.post("/api/v1/people/match", { data: { contactId: typed, verify: false } });
    const {
      rows: [c2],
    } = await db().query("select title, phone, city from contact where id = $1", [typed]);
    expect(c2).toMatchObject({ title: "Chief Tinkerer", phone: "+44 20 0000", city: "Austin" });

    // A contact without an address: the provider's address replaces the unconfirmed pattern guess.
    const noEmail = await insertContact(ws.organizationId, { firstName: "Jo", lastName: "Park", companyId });
    const found = await (
      await api.post("/api/v1/people/match", { data: { contactId: noEmail, verify: false } })
    ).json();
    expect(found.person).toMatchObject({
      email: `jo.park@${domain}`,
      emailSource: "provider",
      emailProvider: "people_data_labs",
    });
    const emailProv = (found.person.provenance as Array<{ field: string; source: string }>).find(
      (p) => p.field === "email",
    );
    expect(emailProv?.source).toBe("provider:people_data_labs");

    // Provider results never reach the shared index.
    const index = await db().query("select 1 from index_person where lower(full_name) in ('riley stone', 'jo park')");
    expect(index.rowCount).toBe(0);

    // Last use is recorded, and the lookups are counted as usage.
    const list = await (await api.get("/api/v1/data_providers")).json();
    const pdlRow = list.data_providers.find((p: { provider: string }) => p.provider === "people_data_labs");
    expect(pdlRow.lastUsedAt).toBeTruthy();
    expect(pdlRow.lastError).toBeNull();
    const usage = await db().query<{ metadata: { counts?: Record<string, number> } }>(
      "select metadata from audit_log where organization_id = $1 and action = 'usage.lookup'",
      [ws.organizationId],
    );
    expect(usage.rows.some((r) => (r.metadata.counts?.provider_lookup ?? 0) > 0)).toBe(true);

    // Turned off, the provider isn't called at all.
    await api.patch(`/api/v1/data_providers/${pdl.data_provider.id}`, { data: { enabled: false } });
    const before = providerCalls.length;
    const other = await insertContact(ws.organizationId, { firstName: "Ari", lastName: "Moss", companyId });
    await api.post("/api/v1/people/match", { data: { contactId: other, verify: false } });
    expect(providerCalls.length).toBe(before);
    const {
      rows: [c3],
    } = await db().query("select title from contact where id = $1", [other]);
    expect(c3.title).toBeNull();
  });

  test("a failing provider stores its error and enrichment still answers", async () => {
    const ws = await freshWorkspace();
    const api = ws.api;
    await api.post("/api/v1/data_providers", { data: { provider: "people_data_labs", apiKey: fakeKey("broke") } });
    const contactId = await insertContact(ws.organizationId, {
      firstName: "Lee",
      lastName: "Fox",
      email: "lee@fox.example",
    });
    const res = await api.post("/api/v1/people/match", { data: { contactId, verify: false } });
    expect(res.status()).toBe(200);
    const list = await (await api.get("/api/v1/data_providers")).json();
    expect(list.data_providers[0].lastError).toMatch(/no credits/);
    expect(list.data_providers[0].lastUsedAt).toBeNull();
  });

  test("organization enrichment fills firmographics the website didn't have", async () => {
    test.setTimeout(120_000);
    const ws = await freshWorkspace();
    const api = ws.api;
    const companyId = crypto.randomUUID();
    await db().query(
      "insert into company (id, organization_id, name, description, source) values ($1, $2, 'Our Name', 'Our own words', 'test')",
      [companyId, ws.organizationId],
    );
    await api.post("/api/v1/data_providers", { data: { provider: "people_data_labs", apiKey: fakeKey("good-co") } });
    const res = await api.post("/api/v1/organizations/enrich", { data: { companyId, website: `${fixture.url}/` } });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    const {
      rows: [co],
    } = await db().query("select name, description, industry, employee_count from company where id = $1", [companyId]);
    expect(co).toMatchObject({
      name: "Our Name",
      description: "Our own words",
      industry: "Computer software",
      employee_count: 120,
    });
    const industry = (body.provenance as Array<{ field: string; source: string }>).find((p) => p.field === "industry");
    expect(industry?.source).toBe("provider:people_data_labs");
  });
});
