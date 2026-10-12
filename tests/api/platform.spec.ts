import { expect, test } from "@playwright/test";

import { ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, apiWithKey, BASE_URL, GLOBEX_OWNER, PLATFORM_ADMIN } from "../support/session";
import { closeDb, createApiKey, latestAudit, workspaceIdBySlug } from "./white-label-helpers";

/**
 * Installation administration. Only the platform administrator (user.role = "admin") passes;
 * workspace roles don't matter and API keys never count. Limit changes here use Globex, never
 * Acme, so they can't interfere with the domains spec running at the same time.
 */
const LIST = "/api/v1/platform/workspaces";

interface Workspace {
  id: string;
  slug: string;
  name: string;
  memberCount: number;
  hostnameLimit: number;
  hostnamesUsed: number;
  hostnames: { hostname: string; status: string; local: boolean }[];
}

test.describe("platform: /api/v1/platform/workspaces", () => {
  let globexId = "";

  test.beforeAll(async () => {
    globexId = await workspaceIdBySlug("globex");
  });

  test.afterAll(async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 1 } });
    await closeDb();
  });

  test("the platform administrator lists every workspace with members and hostnames", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const res = await admin.get(LIST);
    expect(res.status()).toBe(200);
    const { workspaces } = (await res.json()) as { workspaces: Workspace[] };
    const acme = workspaces.find((w) => w.slug === "acme");
    expect(acme).toBeTruthy();
    expect(acme?.memberCount).toBeGreaterThanOrEqual(5);
    expect(acme?.hostnameLimit).toBeGreaterThanOrEqual(0);
    expect(acme?.hostnames).toContainEqual(
      expect.objectContaining({ hostname: "acme.localhost:3410", status: "verified", local: true }),
    );
    expect(workspaces.some((w) => w.slug === "globex")).toBe(true);
  });

  for (const role of ROLES) {
    test(`${role} of a workspace gets 403`, async () => {
      const api = await apiAsRole(role);
      expect((await api.get(LIST)).status()).toBe(403);
      expect((await api.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 5 } })).status()).toBe(403);
    });
  }

  test("another workspace's owner gets 403", async () => {
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(LIST)).status()).toBe(403);
    expect((await globex.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 5 } })).status()).toBe(403);
  });

  test("API keys never count as platform administrators", async () => {
    const { secret, remove } = await createApiKey(PLATFORM_ADMIN, "owner");
    try {
      const api = await apiWithKey(secret);
      expect((await api.get(LIST)).status()).toBe(403);
      expect((await api.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 5 } })).status()).toBe(403);
    } finally {
      await remove();
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get(LIST)).status()).toBe(401);
    expect((await api.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 5 } })).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const res = await admin.patch(`${BASE_URL}${LIST}/${globexId}`, {
      headers: { origin: "https://evil.example" },
      data: { hostnameLimit: 5 },
    });
    expect(res.status()).toBe(403);
  });

  test("the limit must be a whole number from 0 to 50", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    for (const hostnameLimit of [-1, 51, 1.5, "3", null]) {
      const res = await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit } });
      expect(res.status(), String(hostnameLimit)).toBe(422);
    }
    expect((await admin.patch(`${LIST}/${globexId}`, { data: {} })).status()).toBe(422);
    expect((await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 2, extra: 1 } })).status()).toBe(422);
  });

  test("an unknown workspace is 404", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const res = await admin.patch(`${LIST}/00000000-0000-0000-0000-000000000000`, { data: { hostnameLimit: 2 } });
    expect(res.status()).toBe(404);
  });

  test("changing a limit applies to the workspace and is audited there", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const res = await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 7 } });
    expect(res.status()).toBe(200);
    const { workspace } = (await res.json()) as { workspace: Workspace };
    expect(workspace).toMatchObject({ id: globexId, hostnameLimit: 7 });

    const globex = await apiAs(GLOBEX_OWNER);
    expect(await (await globex.get("/api/v1/domains")).json()).toMatchObject({ limit: 7 });

    const audit = await latestAudit("globex", "domain.limit_update", 1);
    expect(audit[0]?.metadata).toMatchObject({ to: 7 });
    expect(audit[0]?.actor_user_id).toBeTruthy();

    expect((await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 1 } })).status()).toBe(200);
  });

  test("the bounds 0 and 50 are accepted", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    expect((await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 0 } })).status()).toBe(200);
    expect((await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 50 } })).status()).toBe(200);
    expect((await admin.patch(`${LIST}/${globexId}`, { data: { hostnameLimit: 1 } })).status()).toBe(200);
  });

  test("the platform administrator can't reach Acme's workspace data through these endpoints", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    // Platform administrators manage limits only; workspace endpoints stay scoped to their own workspace.
    const domains = await (await admin.get("/api/v1/domains")).json();
    expect(domains.domains.map((d: { hostname: string }) => d.hostname)).not.toContain("acme.localhost:3410");
  });
});
