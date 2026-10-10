import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { isRole, outranksOrEquals, ROLES, type Role } from "@/lib/rbac/permissions";
import { type Actor, API_KEY_PREFIX, hashApiKey } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import { randomBytes } from "node:crypto";

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "Name the key.").max(80),
  role: z.enum(ROLES),
});

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  role: Role;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: { id: string; name: string; email: string } | null;
}

const columns = {
  id: schema.apiKey.id,
  name: schema.apiKey.name,
  prefix: schema.apiKey.prefix,
  role: schema.apiKey.role,
  createdAt: schema.apiKey.createdAt,
  lastUsedAt: schema.apiKey.lastUsedAt,
  revokedAt: schema.apiKey.revokedAt,
  createdById: schema.apiKey.createdById,
  createdByName: schema.user.name,
  createdByEmail: schema.user.email,
};

function baseQuery() {
  return db.select(columns).from(schema.apiKey).leftJoin(schema.user, eq(schema.user.id, schema.apiKey.createdById));
}

function toDto(row: Awaited<ReturnType<typeof baseQuery>>[number]): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    role: isRole(row.role) ? row.role : "viewer",
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdBy:
      row.createdById && row.createdByName && row.createdByEmail
        ? { id: row.createdById, name: row.createdByName, email: row.createdByEmail }
        : null,
  };
}

export async function listApiKeys(actor: Actor, page: Page) {
  const condition = eq(schema.apiKey.organizationId, actor.organizationId);
  const [rows, [{ count }]] = await Promise.all([
    baseQuery()
      .where(condition)
      .orderBy(sql`${schema.apiKey.revokedAt} is not null`, desc(schema.apiKey.createdAt))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.apiKey).where(condition),
  ]);
  return { apiKeys: rows.map(toDto), total: count };
}

/** `al_<8 hex>_<43 base64url>`: the visible prefix identifies the key, the rest is 256 bits of entropy. */
function generateSecret(): { secret: string; prefix: string } {
  const prefix = `${API_KEY_PREFIX}${randomBytes(4).toString("hex")}`;
  return { secret: `${prefix}_${randomBytes(32).toString("base64url")}`, prefix };
}

/** Create a key. The secret is returned once and only its SHA-256 hash is stored. */
export async function createApiKey(actor: Actor, input: z.infer<typeof apiKeyCreateSchema>) {
  if (actor.kind !== "user") throw forbidden("API keys can't create other API keys.");
  if (!outranksOrEquals(actor.role, input.role)) throw forbidden("A key can't have a role above your own.");
  const { secret, prefix } = generateSecret();
  const [created] = await db
    .insert(schema.apiKey)
    .values({
      organizationId: actor.organizationId,
      createdById: actor.userId,
      name: input.name,
      prefix,
      hash: hashApiKey(secret),
      role: input.role,
    })
    .returning({ id: schema.apiKey.id });
  await audit(actor, "apikey.create", "api_key", created.id, { name: input.name, role: input.role, prefix });
  const [row] = await baseQuery().where(eq(schema.apiKey.id, created.id)).limit(1);
  return { apiKey: toDto(row), secret };
}

export async function revokeApiKey(actor: Actor, id: string): Promise<ApiKeyDto> {
  const [row] = await baseQuery()
    .where(and(eq(schema.apiKey.organizationId, actor.organizationId), eq(schema.apiKey.id, id)))
    .limit(1);
  if (!row) throw notFound("API key not found.");
  const role = isRole(row.role) ? row.role : "owner";
  if (!outranksOrEquals(actor.role, role)) throw forbidden("You can't revoke a key with a role above your own.");
  if (!row.revokedAt) {
    await db.update(schema.apiKey).set({ revokedAt: new Date() }).where(eq(schema.apiKey.id, id));
    await audit(actor, "apikey.revoke", "api_key", id, { name: row.name, prefix: row.prefix });
  }
  const [updated] = await baseQuery().where(eq(schema.apiKey.id, id)).limit(1);
  return toDto(updated);
}
