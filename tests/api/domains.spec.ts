import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import {
  ACME,
  anonymous,
  apiAs,
  apiAsRole,
  apiWithKey,
  BASE_URL,
  GLOBEX_OWNER,
  PLATFORM_ADMIN,
  TENANT_URL,
} from "../support/session";
import { closeDb, createApiKey, deleteHostnames, latestAudit, workspaceIdBySlug } from "./white-label-helpers";

/**
 * Hostnames this spec creates all contain "wlspec" so a rerun can clean up what a failed run left.
 * Local names (*.localhost:3410) are verified on add; real-looking ones (*.example.invalid) never
 * resolve and stay pending.
 */
const RUN = Date.now().toString(36);
const local = (label: string) => `wlspec-${label}-${RUN}.localhost:3410`;
const remote = (label: string) => `wlspec-${label}-${RUN}.example.invalid`;

interface DomainView {
  id: string;
  hostname: string;
  status: string;
  local: boolean;
  serving: boolean;
  lastError: string | null;
  records: { type: string; name: string; value: string }[];
}

test.describe("domains: /api/v1/domains", () => {
  test.beforeAll(async () => {
    await deleteHostnames("wlspec-%");
  });

  test.afterAll(async () => {
    await deleteHostnames("wlspec-%");
    await closeDb();
  });

  for (const role of ROLES) {
    test(`GET as ${role} follows the matrix`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/domains");
      expect(res.status()).toBe(expected(role, "domain:read"));
      if (res.status() === 200) {
        const body = await res.json();
        expect(body.domains.map((d: DomainView) => d.hostname)).toContain("acme.localhost:3410");
        expect(body).toMatchObject({ limit: 3, localLimit: 10 });
        expect(typeof body.used).toBe("number");
      }
    });

    test(`POST and DELETE as ${role} follow the matrix`, async () => {
      const api = await apiAsRole(role);
      const created = await api.post("/api/v1/domains", { data: { hostname: local(`rbac-${role}`) } });
      expect(created.status()).toBe(expected(role, "domain:manage", 201));
      if (created.status() !== 201) return;
      const { domain } = (await created.json()) as { domain: DomainView };
      expect(domain).toMatchObject({ status: "verified", local: true, serving: true, records: [] });
      const removed = await api.delete(`/api/v1/domains/${domain.id}`);
      expect(removed.status()).toBe(200);
    });
  }

  test("roles without domain:manage can't verify or remove", async () => {
    const owner = await apiAs(ACME.owner);
    const created = await owner.post("/api/v1/domains", { data: { hostname: local("guarded") } });
    expect(created.status()).toBe(201);
    const { domain } = (await created.json()) as { domain: DomainView };
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const verify = await api.post(`/api/v1/domains/${domain.id}/verify`);
      if (expected(role, "domain:manage") === 403) {
        expect(verify.status(), role).toBe(403);
        expect((await api.delete(`/api/v1/domains/${domain.id}`)).status(), role).toBe(403);
      } else {
        // Allowed: 200, or 429 when another allowed role checked it less than 10 seconds ago.
        expect([200, 429], role).toContain(verify.status());
      }
    }
    expect((await owner.delete(`/api/v1/domains/${domain.id}`)).status()).toBe(200);
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/domains")).status()).toBe(401);
    expect((await api.post("/api/v1/domains", { data: { hostname: remote("anon") } })).status()).toBe(401);
    expect((await api.post("/api/v1/domains/00000000-0000-0000-0000-000000000000/verify")).status()).toBe(401);
    expect((await api.delete("/api/v1/domains/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await apiAs(ACME.owner);
    const res = await api.post(`${BASE_URL}/api/v1/domains`, {
      headers: { origin: "https://evil.example" },
      data: { hostname: remote("csrf") },
    });
    expect(res.status()).toBe(403);
  });

  test("invalid and reserved hostnames are 422 with a plain message", async () => {
    const api = await apiAs(ACME.owner);
    const cases: [unknown, RegExp][] = [
      ["", /Enter a hostname/],
      ["not a hostname", /Enter a hostname/],
      ["portal.example.com.", /trailing dot/],
      ["https://portal.example.com/path", /without https/],
      ["203.0.113.7", /not an IP address/],
      ["-bad.example.com", /Enter a hostname/],
      ["single-label", /Enter a hostname/],
      [`${"a".repeat(64)}.example.com`, /Enter a hostname/],
      [`${"abcdefghij.".repeat(25)}com`, /too long/],
      ["localhost:3410", /reserved/],
      ["127.0.0.1:3410", /reserved/],
      [42, /Enter a hostname/],
    ];
    for (const [hostname, message] of cases) {
      const res = await api.post("/api/v1/domains", { data: { hostname } });
      expect(res.status(), String(hostname)).toBe(422);
      const body = await res.json();
      const text = `${body.error} ${JSON.stringify(body.details ?? [])}`;
      expect(text, String(hostname)).toMatch(message);
    }
  });

  test("a hostname belongs to one workspace only", async () => {
    const owner = await apiAs(ACME.owner);
    expect((await owner.post("/api/v1/domains", { data: { hostname: "acme.localhost:3410" } })).status()).toBe(409);
    expect((await owner.post("/api/v1/domains", { data: { hostname: "ACME.localhost:3410" } })).status()).toBe(409);
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.post("/api/v1/domains", { data: { hostname: "acme.localhost:3410" } })).status()).toBe(409);
  });

  test("Globex can't see, verify or remove Acme's hostnames", async () => {
    const owner = await apiAs(ACME.owner);
    const { domains } = await (await owner.get("/api/v1/domains")).json();
    const acmeId = domains.find((d: DomainView) => d.hostname === "acme.localhost:3410").id;
    const globex = await apiAs(GLOBEX_OWNER);
    const list = await (await globex.get("/api/v1/domains")).json();
    expect(list.domains.map((d: DomainView) => d.id)).not.toContain(acmeId);
    expect((await globex.post(`/api/v1/domains/${acmeId}/verify`)).status()).toBe(404);
    expect((await globex.delete(`/api/v1/domains/${acmeId}`)).status()).toBe(404);
    expect((await owner.delete("/api/v1/domains/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
  });

  test("a real-looking hostname stays pending with a plain message, and verify is rate limited", async () => {
    const owner = await apiAs(ACME.owner);
    const hostname = remote("pending");
    const created = await owner.post("/api/v1/domains", { data: { hostname } });
    expect(created.status()).toBe(201);
    const { domain, warning } = (await created.json()) as { domain: DomainView; warning: string | null };
    expect(domain).toMatchObject({ hostname, status: "pending", local: false, serving: false });
    expect(warning).toBeNull();
    const txt = domain.records.find((r) => r.type === "TXT");
    expect(txt?.name).toBe(`_anhour-verify.${hostname}`);
    expect(txt?.value).toMatch(/^anhour-verify=[A-Za-z0-9_-]{32}$/);
    expect(domain.records.find((r) => r.type === "CNAME")).toMatchObject({ name: hostname, value: "localhost" });

    const verify = await owner.post(`/api/v1/domains/${domain.id}/verify`);
    expect(verify.status()).toBe(200);
    const result = await verify.json();
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      `No TXT record found at _anhour-verify.${hostname} yet. DNS changes can take up to an hour.`,
    );
    expect(result.domain.status).toBe("pending");

    const admin = await apiAs(ACME.admin);
    const again = await admin.post(`/api/v1/domains/${domain.id}/verify`);
    expect(again.status()).toBe(429);

    const tlsAsk = await anonymous();
    expect((await tlsAsk.get(`/api/domains/tls-ask?domain=${hostname}`)).status()).toBe(404);
    const audited = await latestAudit("acme", "domain.verify_failed", 5);
    expect(audited.some((a) => a.entity_id === domain.id)).toBe(true);
    expect((await owner.delete(`/api/v1/domains/${domain.id}`)).status()).toBe(200);
  });

  test("the hostname limit is enforced; local names don't count", async () => {
    const platform = await apiAs(PLATFORM_ADMIN);
    const acmeId = await workspaceIdBySlug("acme");
    const owner = await apiAs(ACME.owner);
    try {
      expect(
        (await platform.patch(`/api/v1/platform/workspaces/${acmeId}`, { data: { hostnameLimit: 0 } })).status(),
      ).toBe(200);
      const refused = await owner.post("/api/v1/domains", { data: { hostname: remote("over-limit") } });
      expect(refused.status()).toBe(422);
      expect((await refused.json()).error).toMatch(/aren't included/);
      const localOk = await owner.post("/api/v1/domains", { data: { hostname: local("under-local-cap") } });
      expect(localOk.status()).toBe(201);

      expect(
        (await platform.patch(`/api/v1/platform/workspaces/${acmeId}`, { data: { hostnameLimit: 1 } })).status(),
      ).toBe(200);
      const first = await owner.post("/api/v1/domains", { data: { hostname: remote("limit-one") } });
      expect(first.status()).toBe(201);
      const second = await owner.post("/api/v1/domains", { data: { hostname: remote("limit-two") } });
      expect(second.status()).toBe(422);
      expect((await second.json()).error).toMatch(/used all 1 of your custom hostname/);
      const listed = await (await owner.get("/api/v1/domains")).json();
      expect(listed).toMatchObject({ limit: 1, used: 1 });
    } finally {
      await platform.patch(`/api/v1/platform/workspaces/${acmeId}`, { data: { hostnameLimit: 3 } });
      await deleteHostnames(`wlspec-%-${RUN}.%`);
    }
  });

  test("an apex domain is accepted with a subdomain recommendation", async () => {
    const owner = await apiAs(ACME.owner);
    const created = await owner.post("/api/v1/domains", { data: { hostname: `wlspec${RUN}.invalid` } });
    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.warning).toMatch(/subdomain/);
    expect((await owner.delete(`/api/v1/domains/${body.domain.id}`)).status()).toBe(200);
  });

  test("an API key with an administrator role manages hostnames without a session", async () => {
    const { secret, remove } = await createApiKey(ACME.owner, "admin");
    try {
      const api = await apiWithKey(secret);
      expect((await api.get("/api/v1/domains")).status()).toBe(200);
      const created = await api.post("/api/v1/domains", { data: { hostname: local("api-key") } });
      expect(created.status()).toBe(201);
      const { domain } = await created.json();
      expect((await api.delete(`/api/v1/domains/${domain.id}`)).status()).toBe(200);
    } finally {
      await remove();
    }
  });

  test("tls-ask answers for primary hosts and serving hostnames only", async () => {
    const api = await anonymous();
    const ask = async (domain: string) =>
      (await api.get(`/api/domains/tls-ask?domain=${encodeURIComponent(domain)}`)).status();
    expect(await ask("localhost:3410")).toBe(200);
    expect(await ask("localhost")).toBe(200);
    expect(await ask("acme.localhost:3410")).toBe(200);
    expect(await ask("ACME.localhost:3410")).toBe(200);
    expect(await ask("unknown.localhost:3410")).toBe(404);
    expect(await ask("portal.example.invalid")).toBe(404);
    expect(await ask("bad host")).toBe(404);
    expect(await ask("")).toBe(404);
    expect((await api.get("/api/domains/tls-ask")).status()).toBe(404);
  });

  test("a new local hostname serves the workspace brand at once, and stops when removed", async () => {
    const owner = await apiAs(ACME.owner);
    const hostname = local("live");
    const visitorBefore = await anonymous(`http://${hostname}`);
    // Unknown before it's added (and this lookup is cached, which the add must clear).
    expect((await visitorBefore.get("/auth/login")).status()).toBe(404);

    const created = await owner.post("/api/v1/domains", { data: { hostname } });
    expect(created.status()).toBe(201);
    const { domain } = (await created.json()) as { domain: DomainView };
    expect(domain.status).toBe("verified");

    const visitor = await anonymous(`http://${hostname}`);
    const page = await visitor.get("/auth/login");
    expect(page.status()).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-brand="emerald"');
    expect(html).toContain("Acme Prospecting");
    expect(html).not.toContain("AnhourLeads");
    expect((await (await anonymous()).get(`/api/domains/tls-ask?domain=${hostname}`)).status()).toBe(200);

    // The installation's own host still shows the installation brand to signed-out visitors.
    const primary = await (await anonymous()).get("/auth/login");
    expect(await primary.text()).toContain("AnhourLeads");

    // Members can sign in there; outsiders can't.
    await expect(apiAs(ACME.member, `http://${hostname}`)).resolves.toBeTruthy();

    expect((await owner.delete(`/api/v1/domains/${domain.id}`)).status()).toBe(200);
    expect((await visitor.get("/auth/login")).status()).toBe(404);
    expect((await (await anonymous()).get(`/api/domains/tls-ask?domain=${hostname}`)).status()).toBe(404);
    const removed = await latestAudit("acme", "domain.remove", 5);
    expect(removed.some((a) => a.entity_id === domain.id)).toBe(true);
    const added = await latestAudit("acme", "domain.add", 20);
    expect(added.some((a) => a.entity_id === domain.id)).toBe(true);
  });

  test("the seeded white-label host keeps serving", async () => {
    const res = await (await anonymous(TENANT_URL)).get("/auth/login");
    expect(res.status()).toBe(200);
  });
});
