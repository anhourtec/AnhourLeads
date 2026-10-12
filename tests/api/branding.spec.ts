import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, apiWithKey, BASE_URL, GLOBEX_OWNER, TENANT_URL } from "../support/session";
import { closeDb, createApiKey, latestAudit } from "./white-label-helpers";

/** Acme's seeded brand. Other specs and screens rely on it, so every change here is restored. */
const ACME_BRAND = { brandName: "Acme Prospecting", brandColor: "emerald", supportEmail: "support@acme.test" };
const URL = "/api/v1/workspace/branding";

test.describe("branding: GET/PATCH /api/v1/workspace/branding", () => {
  test.afterAll(async () => {
    const owner = await apiAs(ACME.owner);
    await owner.patch(URL, { data: ACME_BRAND });
    await closeDb();
  });

  for (const role of ROLES) {
    test(`GET as ${role} returns the workspace brand`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get(URL);
      expect(res.status()).toBe(200);
      const { branding } = await res.json();
      expect(branding).toMatchObject({ brandName: "Acme Prospecting", brandColor: "emerald" });
      expect(branding.effective.name).toBe("Acme Prospecting");
      expect(branding.colors).toContain("indigo");
    });

    test(`PATCH as ${role} follows the matrix`, async () => {
      const api = await apiAsRole(role);
      // Same values as seeded: proves the permission without changing what other screens show.
      const res = await api.patch(URL, { data: ACME_BRAND });
      expect(res.status()).toBe(expected(role, "branding:update"));
    });
  }

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get(URL)).status()).toBe(401);
    expect((await api.patch(URL, { data: { brandName: "X" } })).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await apiAs(ACME.owner);
    const res = await api.patch(`${BASE_URL}${URL}`, { headers: { origin: "https://evil.example" }, data: ACME_BRAND });
    expect(res.status()).toBe(403);
  });

  test("validation errors are 422 with field details", async () => {
    const api = await apiAs(ACME.owner);
    const cases: [Record<string, unknown>, string][] = [
      [{ brandName: "x".repeat(61) }, "brandName"],
      [{ brandName: "<script>alert(1)</script>" }, "brandName"],
      [{ brandName: "Line\nbreak" }, "brandName"],
      [{ brandColor: "pink" }, "brandColor"],
      [{ brandColor: "#ff0000" }, "brandColor"],
      [{ supportEmail: "not-an-email" }, "supportEmail"],
      [{ unexpected: true }, ""],
    ];
    for (const [data, path] of cases) {
      const res = await api.patch(URL, { data });
      expect(res.status(), JSON.stringify(data)).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("Some fields are invalid.");
      if (path) expect(body.details.map((d: { path: string }) => d.path)).toContain(path);
    }
  });

  test("Globex sees and changes only its own brand", async () => {
    const globex = await apiAs(GLOBEX_OWNER);
    const res = await globex.get(URL);
    expect(res.status()).toBe(200);
    const { branding } = await res.json();
    expect(branding.effective.name).toBe("Globex");
    expect(branding.brandName).toBeNull();
  });

  test("an API key reads the brand but a viewer key can't change it", async () => {
    const { secret, remove } = await createApiKey(ACME.owner, "viewer");
    try {
      const api = await apiWithKey(secret);
      expect((await api.get(URL)).status()).toBe(200);
      expect((await api.patch(URL, { data: ACME_BRAND })).status()).toBe(403);
    } finally {
      await remove();
    }
  });

  test("a change shows on the white-label host straight away, and null resets to defaults", async () => {
    const owner = await apiAs(ACME.owner);
    try {
      const changed = await owner.patch(URL, {
        data: { brandName: "Acme Spec Brand", brandColor: "rose", supportEmail: "Help@Acme.test" },
      });
      expect(changed.status()).toBe(200);
      const { branding } = await changed.json();
      expect(branding).toMatchObject({
        brandName: "Acme Spec Brand",
        brandColor: "rose",
        supportEmail: "help@acme.test",
      });

      const visitor = await anonymous(TENANT_URL);
      const html = await (await visitor.get("/auth/login")).text();
      expect(html).toContain('data-brand="rose"');
      expect(html).toContain("Acme Spec Brand");
      expect(html).toContain("help@acme.test");

      const reset = await owner.patch(URL, { data: { brandName: null, brandColor: null, supportEmail: "" } });
      expect(reset.status()).toBe(200);
      const after = (await reset.json()).branding;
      expect(after).toMatchObject({ brandName: null, brandColor: null, supportEmail: null });
      expect(after.effective).toMatchObject({ name: "Acme Outbound", color: "indigo" });
      const resetHtml = await (await visitor.get("/auth/login")).text();
      expect(resetHtml).toContain('data-brand="indigo"');
      expect(resetHtml).toContain("Acme Outbound");
    } finally {
      expect((await owner.patch(URL, { data: ACME_BRAND })).status()).toBe(200);
    }
    const restored = await (await anonymous(TENANT_URL)).get("/auth/login");
    expect(await restored.text()).toContain('data-brand="emerald"');
  });

  test("branding changes are audited", async () => {
    const owner = await apiAs(ACME.owner);
    await owner.patch(URL, { data: { supportEmail: "audit-check@acme.test" } });
    await owner.patch(URL, { data: ACME_BRAND });
    const rows = await latestAudit("acme", "branding.update", 2);
    expect(rows.length).toBe(2);
    expect(JSON.stringify(rows[1].metadata)).toContain("audit-check@acme.test");
  });
});
