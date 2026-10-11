import "server-only";

import { and, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { type Page, pagination } from "@/server/http/route";

/** A record's activity timeline (contact or account), newest first. */

export const activityQuerySchema = z.object({
  type: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .transform((v) => [...new Set(v.map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(64)).max(30))
    .optional(),
});

export interface ActivityDto {
  id: string;
  type: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  actor: { id: string; name: string } | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  occurredAt: string;
}

const a = schema.activity;

async function timeline(actor: Actor, scope: SQL, types: string[] | undefined, page: Page) {
  const where = and(
    eq(a.organizationId, actor.organizationId),
    scope,
    types?.length ? inArray(a.type, types) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: a.id,
        type: a.type,
        summary: a.summary,
        metadata: a.metadata,
        actorUserId: a.actorUserId,
        actorName: schema.user.name,
        contactId: a.contactId,
        companyId: a.companyId,
        dealId: a.dealId,
        occurredAt: a.occurredAt,
      })
      .from(a)
      .leftJoin(schema.user, eq(schema.user.id, a.actorUserId))
      .where(where)
      .orderBy(desc(a.occurredAt), desc(a.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(a).where(where),
  ]);
  const activities: ActivityDto[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    summary: r.summary,
    metadata: r.metadata ?? null,
    actor: r.actorUserId ? { id: r.actorUserId, name: r.actorName ?? "Former member" } : null,
    contactId: r.contactId,
    companyId: r.companyId,
    dealId: r.dealId,
    occurredAt: r.occurredAt.toISOString(),
  }));
  return { activities, pagination: pagination(page, total) };
}

export async function contactActivities(actor: Actor, contactId: string, types: string[] | undefined, page: Page) {
  const [row] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), eq(schema.contact.id, contactId)))
    .limit(1);
  if (!row) throw notFound("Contact not found.");
  return timeline(actor, eq(a.contactId, contactId), types, page);
}

export async function accountActivities(actor: Actor, companyId: string, types: string[] | undefined, page: Page) {
  const [row] = await db
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(and(eq(schema.company.organizationId, actor.organizationId), eq(schema.company.id, companyId)))
    .limit(1);
  if (!row) throw notFound("Company not found.");
  const people = db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), eq(schema.contact.companyId, companyId)));
  return timeline(actor, or(eq(a.companyId, companyId), inArray(a.contactId, people)) as SQL, types, page);
}
