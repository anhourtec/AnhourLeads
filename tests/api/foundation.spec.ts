import { expect, test } from "@playwright/test";

import { ACME, anonymous, apiAs, BASE_URL, GLOBEX_OWNER, PASSWORD, TENANT_URL } from "../support/session";

test.describe("foundation: health, auth, tenancy", () => {
  test("liveness and readiness", async () => {
    const api = await anonymous();
    expect((await api.get("/api/health")).status()).toBe(200);
    const ready = await api.get("/api/health/ready");
    expect(ready.status()).toBe(200);
    expect((await ready.json()).checks).toEqual({ postgres: "ok", redis: "ok" });
  });

  test("every role can sign in on the primary host", async () => {
    for (const email of Object.values(ACME)) {
      await expect(apiAs(email)).resolves.toBeTruthy();
    }
  });

  test("wrong password is refused", async () => {
    const api = await anonymous();
    const res = await api.post("/api/auth/sign-in/email", { data: { email: ACME.owner, password: "nope-nope-nope" } });
    expect(res.status()).toBe(401);
  });

  test("workspace host accepts its members and refuses outsiders with the same message", async () => {
    await expect(apiAs(ACME.viewer, TENANT_URL)).resolves.toBeTruthy();
    const api = await anonymous(TENANT_URL);
    const res = await api.post("/api/auth/sign-in/email", { data: { email: GLOBEX_OWNER, password: PASSWORD } });
    expect(res.status()).toBe(401);
    expect((await res.json()).message).toBe("Invalid email or password");
  });

  test("workspace host refuses sign-up", async () => {
    const api = await anonymous(TENANT_URL);
    const res = await api.post("/api/auth/sign-up/email", {
      data: { email: "new@example.com", password: "long-enough-password", name: "New" },
    });
    expect(res.status()).toBe(403);
  });

  test("unknown hosts get 404 for pages and auth", async () => {
    const api = await anonymous("http://unknown.localhost:3410");
    expect((await api.get("/auth/login")).status()).toBe(404);
    expect((await api.post("/api/auth/sign-in/email", { data: {} })).status()).toBe(404);
  });

  test("template demo routes are hidden", async () => {
    const api = await apiAs(ACME.owner);
    expect((await api.get("/dashboard/crm")).status()).toBe(404);
    expect((await api.get("/auth/v2/login")).status()).toBe(404);
  });

  test("signed-out dashboard redirects to sign-in", async () => {
    const api = await anonymous();
    const res = await api.get("/dashboard/overview", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain("/auth/login");
  });

  test("sign-up creates a workspace owned by the new user", async () => {
    const api = await anonymous();
    const email = `signup-${Date.now()}@example.com`;
    const signUp = await api.post("/api/auth/sign-up/email", {
      data: { email, password: "long-enough-password", name: "New Person" },
    });
    expect(signUp.status()).toBe(200);
    const created = await api.post("/api/v1/workspaces/register", { data: { workspaceName: "New Co" } });
    expect(created.status()).toBe(201);
    const again = await api.post("/api/v1/workspaces/register", { data: { workspaceName: "Second" } });
    expect(again.status()).toBe(409);
  });

  test("workspace registration refuses cross-site requests", async () => {
    const api = await apiAs(ACME.owner);
    const res = await api.post(`${BASE_URL}/api/v1/workspaces/register`, {
      headers: { origin: "https://evil.example" },
      data: { workspaceName: "X" },
    });
    expect(res.status()).toBe(403);
  });
});
