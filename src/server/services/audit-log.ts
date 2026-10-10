import "server-only";

import { and, desc, eq, gte, like, lte, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import type { Page } from "@/server/http/route";

import { dateInput, refId } from "./workspace-refs";

export const auditLogSearchSchema = z.object({
  /** Action prefix, e.g. "member." or "task.create". */
  action: z.string().trim().max(80).optional(),
  actorId: refId.optional(),
  apiKeyId: refId.optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: refId.optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor:
    | { kind: "user"; id: string; name: string | null; email: string | null }
    | { kind: "apiKey"; id: string; name: string | null; prefix: string | null; userId: string | null }
    | { kind: "system" };
}

function actorOf(r: {
  actorUserId: string | null;
  actorApiKeyId: string | null;
  userName: string | null;
  userEmail: string | null;
  keyName: string | null;
  keyPrefix: string | null;
}): AuditLogDto["actor"] {
  if (r.actorApiKeyId) {
    return { kind: "apiKey", id: r.actorApiKeyId, name: r.keyName, prefix: r.keyPrefix, userId: r.actorUserId };
  }
  if (r.actorUserId) return { kind: "user", id: r.actorUserId, name: r.userName, email: r.userEmail };
  return { kind: "system" };
}

export async function searchAuditLog(actor: Actor, input: z.infer<typeof auditLogSearchSchema>, page: Page) {
  const where: SQL[] = [eq(schema.auditLog.organizationId, actor.organizationId)];
  if (input.action) where.push(like(schema.auditLog.action, `${input.action.replace(/[%_\\]/g, "\\$&")}%`));
  if (input.actorId) where.push(eq(schema.auditLog.actorUserId, input.actorId));
  if (input.apiKeyId) where.push(eq(schema.auditLog.actorApiKeyId, input.apiKeyId));
  if (input.entityType) where.push(eq(schema.auditLog.entityType, input.entityType));
  if (input.entityId) where.push(eq(schema.auditLog.entityId, input.entityId));
  if (input.from) where.push(gte(schema.auditLog.createdAt, input.from));
  if (input.to) where.push(lte(schema.auditLog.createdAt, input.to));
  const condition = and(...where);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        entityType: schema.auditLog.entityType,
        entityId: schema.auditLog.entityId,
        metadata: schema.auditLog.metadata,
        createdAt: schema.auditLog.createdAt,
        actorUserId: schema.auditLog.actorUserId,
        actorApiKeyId: schema.auditLog.actorApiKeyId,
        userName: schema.user.name,
        userEmail: schema.user.email,
        keyName: schema.apiKey.name,
        keyPrefix: schema.apiKey.prefix,
      })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorUserId))
      .leftJoin(
        schema.apiKey,
        and(
          eq(schema.apiKey.id, schema.auditLog.actorApiKeyId),
          eq(schema.apiKey.organizationId, schema.auditLog.organizationId),
        ),
      )
      .where(condition)
      .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.auditLog).where(condition),
  ]);

  const auditLogs: AuditLogDto[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadata ?? null,
    createdAt: r.createdAt.toISOString(),
    actor: actorOf(r),
  }));
  return { auditLogs, total: count };
}

/** Distinct entity types seen in this workspace's log, for filter menus. */
export async function auditEntityTypes(actor: Actor): Promise<string[]> {
  const rows = await db
    .selectDistinct({ entityType: schema.auditLog.entityType })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.organizationId, actor.organizationId))
    .orderBy(schema.auditLog.entityType);
  return rows.map((r) => r.entityType);
}
