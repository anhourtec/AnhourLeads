import { type APIRequestContext, expect, test } from "@playwright/test";

import { closeDiscoDb, q } from "../support/discovery-fixtures";
import { ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, apiWithKey, GLOBEX_OWNER, PLATFORM_ADMIN } from "../support/session";
import { closeDb, createApiKey } from "./white-label-helpers";

/**
 * Platform administration of the discovery pipeline: only the installation's platform
 * administrator may use these endpoints. Every workspace role and API keys get 403 (even an
 * owner key created by the platform administrator), signed-out requests 401.
 */

const RUN = Date.now().toString(36);
let sourceId = "";
let originalSettings: Record<string, unknown> | null = null;

type Call = [method: "get" | "post" | "patch" | "delete", path: () => string, data?: unknown];

const CALLS: Call[] = [
  ["get", () => "/api/v1/platform/seed_sources"],
  ["post", () => "/api/v1/platform/seed_sources", { kind: "manual", name: "WP-F admin spec forbidden" }],
  ["get", () => `/api/v1/platform/seed_sources/${sourceId}`],
  ["patch", () => `/api/v1/platform/seed_sources/${sourceId}`, { enabled: false }],
  ["post", () => `/api/v1/platform/seed_sources/${sourceId}/run`, {}],
  ["get", () => "/api/v1/platform/crawler/stats"],
  ["get", () => "/api/v1/platform/crawler/frontier"],
  ["get", () => "/api/v1/platform/crawler/hosts"],
  ["post", () => `/api/v1/platform/crawler/hosts/admin-spec-${RUN}.example/block`, {}],
  ["post", () => `/api/v1/platform/crawler/hosts/admin-spec-${RUN}.example/unblock`, {}],
  ["post", () => "/api/v1/platform/crawler/run_once", { max: 1, hosts: ["nothing.invalid"] }],
  ["get", () => "/api/v1/platform/crawler/settings"],
  ["patch", () => "/api/v1/platform/crawler/settings", { retentionDays: 180 }],
  ["get", () => "/api/v1/platform/optouts"],
  ["post", () => "/api/v1/platform/optouts", { kind: "domain", value: `forbidden-${RUN}.example` }],
  ["delete", () => "/api/v1/platform/optouts/no-such-optout"],
  ["get", () => "/api/v1/platform/optouts/requests"],
];

async function call(api: APIRequestContext, [method, path, data]: Call, headers?: Record<string, string>) {
  const options = { ...(data === undefined ? {} : { data }), ...(headers ? { headers } : {}) };
  return api[method](path(), options);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const admin = await apiAs(PLATFORM_ADMIN);
  const res = await admin.post("/api/v1/platform/seed_sources", {
    data: {
      kind: "domain_list",
      name: `WP-F admin spec ${RUN}`,
      text: `rank,domain\n1,admin-${RUN}.example\n2,linkedin.com`,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  sourceId = (await res.json()).seed_source.id;
  originalSettings = (await (await admin.get("/api/v1/platform/crawler/settings")).json()).settings;
});

test.afterAll(async () => {
  const admin = await apiAs(PLATFORM_ADMIN);
  if (originalSettings) await admin.patch("/api/v1/platform/crawler/settings", { data: originalSettings });
  await q("delete from seed_source where name like 'WP-F admin spec%'");
  await q("delete from crawl_frontier where host like $1", [`%${RUN}.example`]);
  await q("delete from crawl_host where host like $1", [`%${RUN}.example`]);
  await q("delete from index_optout where value like $1", [`%${RUN}.example`]);
  await closeDiscoDb();
  await closeDb();
});

test.describe("platform discovery: access", () => {
  for (const role of ROLES) {
    test(`Acme ${role} gets 403 on every platform discovery endpoint`, async () => {
      const api = await apiAsRole(role);
      for (const c of CALLS) expect((await call(api, c)).status(), `${c[0]} ${c[1]()}`).toBe(403);
    });
  }

  test("another workspace's owner gets 403", async () => {
    const api = await apiAs(GLOBEX_OWNER);
    for (const c of CALLS) expect((await call(api, c)).status(), `${c[0]} ${c[1]()}`).toBe(403);
  });

  test("API keys never count as platform administrators", async () => {
    const { secret, remove } = await createApiKey(PLATFORM_ADMIN, "owner");
    try {
      const api = await apiWithKey(secret);
      for (const c of CALLS) expect((await call(api, c)).status(), `${c[0]} ${c[1]()}`).toBe(403);
    } finally {
      await remove();
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    for (const c of CALLS) expect((await call(api, c)).status(), `${c[0]} ${c[1]()}`).toBe(401);
  });

  test("cross-site cookie writes are refused, even for the platform administrator", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    for (const c of CALLS.filter(([m]) => m !== "get")) {
      expect((await call(admin, c, { origin: "https://evil.example" })).status(), `${c[0]} ${c[1]()}`).toBe(403);
    }
  });

  test("the platform administrator can read every endpoint", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    for (const c of CALLS.filter(([m]) => m === "get")) expect((await call(admin, c)).status(), c[1]()).toBe(200);
  });
});

test.describe("platform discovery: behaviour", () => {
  test("seed sources: list includes the built-in kinds; domain lists parse CSV and run", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const list = await (await admin.get("/api/v1/platform/seed_sources")).json();
    const kinds = new Set(list.seed_sources.map((s: { kind: string }) => s.kind));
    for (const k of ["wikidata", "sitemap", "ats_boards", "manual", "domain_list", "companies_house", "sec_edgar"])
      expect(kinds.has(k), k).toBe(true);

    const one = await (await admin.get(`/api/v1/platform/seed_sources/${sourceId}`)).json();
    expect(one.seed_source).toMatchObject({ kind: "domain_list", enabled: false, domainCount: 2 });
    expect(one.seed_source.config.domains).toEqual([`https://admin-${RUN}.example/`, "https://linkedin.com/"]);

    const patched = await admin.patch(`/api/v1/platform/seed_sources/${sourceId}`, {
      data: { enabled: true, text: `another-${RUN}.example`, config: { everyDays: 3 } },
    });
    expect(patched.status(), await patched.text()).toBe(200);
    expect((await patched.json()).seed_source).toMatchObject({
      enabled: true,
      domainCount: 3,
      config: { everyDays: 3 },
    });

    const run = await admin.post(`/api/v1/platform/seed_sources/${sourceId}/run`, { data: {} });
    expect(run.status(), await run.text()).toBe(200);
    const stats = (await run.json()).seed_source.stats;
    expect(stats).toMatchObject({ fetched: 3, errors: [] });
    const frontier = await admin.get(`/api/v1/platform/crawler/frontier?host=admin-${RUN}.example`);
    expect((await frontier.json()).frontier).toEqual([
      expect.objectContaining({ url: `https://admin-${RUN}.example/`, kind: "homepage", status: "queued" }),
    ]);
    await admin.patch(`/api/v1/platform/seed_sources/${sourceId}`, { data: { enabled: false } });
  });

  test("hosts: block and unblock by hand", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const host = `admin-${RUN}.example`;
    const blocked = await admin.post(`/api/v1/platform/crawler/hosts/${host}/block`, {
      data: { reason: "Asked us to stop" },
    });
    expect(blocked.status()).toBe(200);
    expect((await blocked.json()).host).toMatchObject({ host, blocked: true, blockedReason: "Asked us to stop" });
    const list = await (await admin.get("/api/v1/platform/crawler/hosts?state=blocked&q=" + host)).json();
    expect(list.hosts.map((h: { host: string }) => h.host)).toEqual([host]);
    const unblocked = await admin.post(`/api/v1/platform/crawler/hosts/${host}/unblock`);
    expect((await unblocked.json()).host).toMatchObject({ blocked: false, errorCount: 0 });
    expect((await admin.post(`/api/v1/platform/crawler/hosts/never-seen-${RUN}.example/unblock`)).status()).toBe(404);
  });

  test("settings: retention and re-crawl intervals round-trip", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const res = await admin.patch("/api/v1/platform/crawler/settings", {
      data: { retentionDays: 90, recrawlDays: { team: 7 } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const { settings } = await res.json();
    expect(settings.retentionDays).toBe(90);
    expect(settings.recrawlDays.team).toBe(7);
    expect(settings.recrawlDays.homepage).toBe(
      (originalSettings?.recrawlDays as Record<string, number> | undefined)?.homepage,
    );
    expect((await (await admin.get("/api/v1/platform/crawler/settings")).json()).settings.retentionDays).toBe(90);
  });

  test("opt-outs: add (normalised), list, delete", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const email = await admin.post("/api/v1/platform/optouts", {
      data: { kind: "email", value: ` Someone@Admin-${RUN}.Example ` },
    });
    expect(email.status(), await email.text()).toBe(201);
    const optout = (await email.json()).optout;
    expect(optout.value).toBe(`someone@admin-${RUN}.example`);
    const again = await admin.post("/api/v1/platform/optouts", {
      data: { kind: "email", value: `someone@admin-${RUN}.example` },
    });
    expect(again.status()).toBe(200);
    expect((await again.json()).created).toBe(false);
    const list = await (await admin.get(`/api/v1/platform/optouts?q=admin-${RUN}`)).json();
    expect(list.optouts.map((o: { id: string }) => o.id)).toEqual([optout.id]);
    expect((await admin.delete(`/api/v1/platform/optouts/${optout.id}`)).status()).toBe(200);
    expect((await admin.delete(`/api/v1/platform/optouts/${optout.id}`)).status()).toBe(404);
  });

  test("invalid input gets 422", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const bad: Array<[string, string, unknown]> = [
      ["post", "/api/v1/platform/seed_sources", { kind: "scraper", name: "x" }],
      ["post", "/api/v1/platform/seed_sources", { kind: "manual", name: "" }],
      ["post", "/api/v1/platform/seed_sources", { kind: "wikidata", name: "x", config: { countries: ["USA"] } }],
      ["post", "/api/v1/platform/seed_sources", { kind: "wikidata", name: "x", config: { endpoint: "ftp://x" } }],
      ["post", "/api/v1/platform/seed_sources", { kind: "ats_boards", name: "x", config: { unknown: true } }],
      ["patch", `/api/v1/platform/seed_sources/${sourceId}`, { enabled: "yes" }],
      ["post", "/api/v1/platform/crawler/run_once", { max: 0 }],
      ["patch", "/api/v1/platform/crawler/settings", { retentionDays: 1 }],
      ["patch", "/api/v1/platform/crawler/settings", { recrawlDays: { homepage: 0 } }],
      ["post", "/api/v1/platform/optouts", { kind: "email", value: "not-an-email" }],
      ["post", "/api/v1/platform/optouts", { kind: "person", value: "Jane Doe" }],
      ["post", "/api/v1/platform/optouts", { kind: "phone", value: "123" }],
    ];
    for (const [method, path, data] of bad) {
      const res = method === "post" ? await admin.post(path, { data }) : await admin.patch(path, { data });
      expect(res.status(), `${method} ${path} ${JSON.stringify(data)}`).toBe(422);
    }
    expect((await admin.get("/api/v1/platform/seed_sources/no-such-source")).status()).toBe(404);
    expect((await admin.get("/api/v1/platform/crawler/frontier?status=bogus")).status()).toBe(422);
  });

  test("the owner of a workspace is not a platform administrator just by role", async () => {
    const owner = await apiAs(ACME.owner);
    expect((await owner.get("/api/v1/platform/crawler/stats")).status()).toBe(403);
  });
});
