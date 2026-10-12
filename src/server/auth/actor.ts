import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { can, isRole, type Permission, type Role } from "@/lib/rbac/permissions";
import { db, schema } from "@/server/db";
import { forbidden, unauthorized } from "@/server/http/errors";
import { requestHost, resolveTenant, type Tenant } from "@/server/tenancy/host";

import { getAuth } from "./auth";
import { createHash } from "node:crypto";

/** Who is making a request, in which workspace, with which role. Services take this and check it. */
export interface Actor {
  kind: "user" | "apiKey";
  userId: string | null;
  apiKeyId: string | null;
  organizationId: string;
  role: Role;
  isPlatformAdmin: boolean;
  tenant: Tenant;
}

export const API_KEY_PREFIX = "al_";

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function apiKeyFrom(headers: Headers): string | null {
  const header = headers.get("x-api-key");
  if (header) return header.trim();
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer?.startsWith(API_KEY_PREFIX) ? bearer.trim() : null;
}

async function memberRole(userId: string, organizationId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  return row && isRole(row.role) ? row.role : null;
}

/** Signed-in user (no workspace required). Returns null when not signed in. */
export async function getSessionUser(headers: Headers) {
  const tenant = await resolveTenant(requestHost(headers));
  if (!tenant) return null;
  const session = await getAuth(tenant).api.getSession({ headers });
  return session ? { ...session, tenant } : null;
}

/**
 * Resolve the actor from an API key (`X-Api-Key` or `Authorization: Bearer al_…`) or the session
 * cookie. Throws 401 when neither is valid, 403 when the user has no workspace on this host.
 */
export async function resolveActor(headers: Headers): Promise<Actor> {
  const tenant = await resolveTenant(requestHost(headers));
  if (!tenant) throw unauthorized();

  const secret = apiKeyFrom(headers);
  if (secret) {
    const [key] = await db
      .select()
      .from(schema.apiKey)
      .where(and(eq(schema.apiKey.hash, hashApiKey(secret)), isNull(schema.apiKey.revokedAt)))
      .limit(1);
    if (!key || !isRole(key.role)) throw unauthorized("Invalid API key.");
    if (tenant.kind === "workspace" && tenant.organizationId !== key.organizationId) {
      throw unauthorized("Invalid API key.");
    }
    void db.update(schema.apiKey).set({ lastUsedAt: new Date() }).where(eq(schema.apiKey.id, key.id)).execute();
    return {
      kind: "apiKey",
      userId: key.createdById,
      apiKeyId: key.id,
      organizationId: key.organizationId,
      role: key.role,
      isPlatformAdmin: false,
      tenant,
    };
  }

  const session = await getAuth(tenant).api.getSession({ headers });
  if (!session) throw unauthorized();
  const organizationId =
    tenant.kind === "workspace"
      ? tenant.organizationId
      : (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
  if (!organizationId) throw forbidden("You aren't a member of any workspace yet.");
  const role = await memberRole(session.user.id, organizationId);
  if (!role) throw forbidden("You aren't a member of this workspace.");
  return {
    kind: "user",
    userId: session.user.id,
    apiKeyId: null,
    organizationId,
    role,
    isPlatformAdmin: (session.user as { role?: string | null }).role === "admin",
    tenant,
  };
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw forbidden();
}
