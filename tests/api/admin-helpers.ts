import "dotenv/config";

import { type APIRequestContext, expect, request } from "@playwright/test";
import { Pool } from "pg";

import type { Role } from "../../src/lib/rbac/permissions";
import { ACME, apiAs, apiAsRole, apiWithKey, BASE_URL, GLOBEX_OWNER, PASSWORD } from "../support/session";

export const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://localhost:48026";
export const EVIL_ORIGIN = { origin: "https://evil.example" };

let counter = 0;
/** A short unique suffix for names and emails created by a test. */
export function uniq(prefix = "t"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${process.pid.toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

let pool: Pool | null = null;
/** Direct database access for fixtures other domains own (contacts, enrollments) and for asserting side effects. */
export function db(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

export async function orgIdOf(slug: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>("select id from organization where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`workspace ${slug} not found`);
  return rows[0].id;
}

export async function userIdOf(email: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>('select id from "user" where email = $1', [email]);
  if (!rows[0]) throw new Error(`user ${email} not found`);
  return rows[0].id;
}

/** Insert a contact straight into a workspace (fixture only). */
export async function insertContact(
  organizationId: string,
  fields: { email?: string | null; firstName?: string; lastName?: string; companyId?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db().query(
    `insert into contact (id, organization_id, first_name, last_name, email, company_id, source)
     values ($1, $2, $3, $4, $5, $6, 'test')`,
    [
      id,
      organizationId,
      fields.firstName ?? "Test",
      fields.lastName ?? "Person",
      fields.email ?? null,
      fields.companyId ?? null,
    ],
  );
  return id;
}

/** Enroll a contact in a fresh sequence (fixture only). Returns the enrollment id. */
export async function insertEnrollment(organizationId: string, contactId: string): Promise<string> {
  const sequenceId = crypto.randomUUID();
  await db().query(`insert into sequence (id, organization_id, name, status) values ($1, $2, $3, 'active')`, [
    sequenceId,
    organizationId,
    uniq("seq"),
  ]);
  const id = crypto.randomUUID();
  await db().query(
    `insert into enrollment (id, organization_id, sequence_id, contact_id, status) values ($1, $2, $3, $4, 'active')`,
    [id, organizationId, sequenceId, contactId],
  );
  return id;
}

/** Keys are cached per worker so specs don't hit the key-creation rate limit. */
const keyCache = new Map<string, Promise<{ id: string; secret: string }>>();

/** Who creates a key of each role (spreads creation across two accounts to stay under the sensitive limit). */
const KEY_CREATOR: Record<Role, Role> = {
  owner: "owner",
  admin: "owner",
  manager: "admin",
  member: "admin",
  viewer: "admin",
};

export async function createKey(api: APIRequestContext, role: Role, name = uniq("key")) {
  const res = await api.post("/api/v1/api_keys", { data: { name, role } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { id: body.api_key.id as string, secret: body.secret as string };
}

/** An Acme API key with `role`, created through the API by an owner or admin. */
export function acmeKey(role: Role): Promise<{ id: string; secret: string }> {
  const key = `acme:${role}`;
  let pending = keyCache.get(key);
  if (!pending) {
    pending = (async () => createKey(await apiAsRole(KEY_CREATOR[role]), role, uniq(`acme-${role}`)))();
    keyCache.set(key, pending);
  }
  return pending;
}

export async function acmeKeyClient(role: Role): Promise<APIRequestContext> {
  return apiWithKey((await acmeKey(role)).secret);
}

/** An owner-role key for Globex (the other workspace), for isolation checks. */
export function globexKey(): Promise<{ id: string; secret: string }> {
  let pending = keyCache.get("globex:owner");
  if (!pending) {
    pending = (async () => createKey(await apiAs(GLOBEX_OWNER), "owner", uniq("globex")))();
    keyCache.set("globex:owner", pending);
  }
  return pending;
}

export const globexApi = () => apiAs(GLOBEX_OWNER);
export const acmeOrgId = () => orgIdOf("acme");

/** Sign up a brand-new account on the primary host. The returned client carries its session. */
export async function signUpFresh(prefix = "fresh"): Promise<{ email: string; api: APIRequestContext }> {
  const email = `${uniq(prefix)}@example.com`.toLowerCase();
  const api = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const res = await api.post("/api/auth/sign-up/email", {
    data: { email, password: PASSWORD, name: `Fresh ${prefix}` },
  });
  expect(res.status(), await res.text()).toBe(200);
  return { email, api };
}

/** A new workspace with a freshly signed-up owner. */
export async function freshWorkspace(name = uniq("Workspace")) {
  const owner = await signUpFresh("wsowner");
  const res = await owner.api.post("/api/v1/workspaces/register", { data: { workspaceName: name } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { ...owner, name, organizationId: body.workspace.id as string, userId: await userIdOf(owner.email) };
}

export async function invite(inviter: APIRequestContext, email: string, role: Role): Promise<string> {
  const res = await inviter.post("/api/v1/users/invite", { data: { email, role } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).invitation.id as string;
}

export async function acceptInvite(api: APIRequestContext, invitationId: string) {
  const res = await api.post("/api/auth/organization/accept-invitation", { data: { invitationId } });
  expect(res.status(), await res.text()).toBe(200);
}

/** Invite a fresh account into the inviter's workspace with `role` and accept it. */
export async function addFreshMember(inviter: APIRequestContext, role: Role, prefix = "member") {
  const fresh = await signUpFresh(prefix);
  await acceptInvite(fresh.api, await invite(inviter, fresh.email, role));
  return { ...fresh, userId: await userIdOf(fresh.email) };
}

/** Find the invitation email in Mailpit (polls briefly). */
export async function findMail(to: string): Promise<{ ID: string; Subject: string } | null> {
  const api = await request.newContext();
  for (let i = 0; i < 20; i++) {
    const res = await api.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok()) {
      const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
      if (body.messages.length) return body.messages[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

export async function mailText(id: string): Promise<string> {
  const api = await request.newContext();
  const res = await api.get(`${MAILPIT}/api/v1/message/${id}`);
  return ((await res.json()) as { Text: string }).Text;
}

export { ACME };
