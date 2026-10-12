import { type APIRequestContext, type Browser, type BrowserContext, request } from "@playwright/test";

import type { Role } from "../../src/lib/rbac/permissions";

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3410";
export const TENANT_URL = "http://acme.localhost:3410";
export const PASSWORD = "demo-password-1234";

/** Seeded accounts (scripts/seed.ts). */
export const ACME: Record<Role, string> = {
  owner: "owner@acme.test",
  admin: "admin@acme.test",
  manager: "manager@acme.test",
  member: "member@acme.test",
  viewer: "viewer@acme.test",
};
export const GLOBEX_OWNER = "owner@globex.test";
export const PLATFORM_ADMIN = process.env.SEED_PLATFORM_ADMIN_EMAIL ?? "admin@anhourleads.local";

const cache = new Map<string, Promise<APIRequestContext>>();

/**
 * An API client signed in as `email`. It sends the Origin header the CSRF check expects, so writes
 * behave exactly as from the browser. Cached per email and base URL for the worker.
 */
export function apiAs(email: string, baseURL = BASE_URL): Promise<APIRequestContext> {
  const key = `${baseURL}|${email}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
      const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password: PASSWORD } });
      if (!res.ok()) throw new Error(`sign-in failed for ${email}: ${res.status()} ${await res.text()}`);
      return ctx;
    })();
    cache.set(key, pending);
  }
  return pending;
}

export const apiAsRole = (role: Role) => apiAs(ACME[role]);

/** An unauthenticated client (with Origin), for 401 checks. */
export function anonymous(baseURL = BASE_URL): Promise<APIRequestContext> {
  return request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
}

/** A client authenticating with an API key instead of a session (no cookies, no Origin). */
export function apiWithKey(key: string, baseURL = BASE_URL): Promise<APIRequestContext> {
  return request.newContext({ baseURL, extraHTTPHeaders: { "x-api-key": key } });
}

/**
 * A browser context for UI tests. Hides the Next.js dev-tools button: its position is a local
 * preference (it can be dragged to any corner) and it would otherwise cover buttons under test.
 */
export async function newUiContext(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style), { once: true });
  });
  return context;
}

/** A browser context signed in as `email` (for UI tests). */
export async function browserAs(browser: Browser, email: string, baseURL = BASE_URL): Promise<BrowserContext> {
  const api = await apiAs(email, baseURL);
  return newUiContext(browser, { baseURL, storageState: await api.storageState() });
}
