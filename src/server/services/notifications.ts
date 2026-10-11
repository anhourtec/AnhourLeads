import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";
import { log } from "@/server/log";

/** What a notification is about. Other features pass their own `type` (e.g. "sequence_paused"). */
export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  /** In-app path the notification opens, e.g. "/dashboard/sequences/123". */
  link?: string | null;
}

/**
 * Notify members of a workspace. Only current members of `organizationId` receive it; anyone else in
 * `userIds` is ignored. Never throws into the caller: failures are logged.
 */
export async function notify(userIds: string[], input: NotificationInput, organizationId: string): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return 0;
  try {
    const members = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, organizationId), inArray(schema.member.userId, unique)));
    if (!members.length) return 0;
    const link = input.link?.startsWith("/") && !input.link.startsWith("//") ? input.link : null;
    await db.insert(schema.notification).values(
      members.map((m) => ({
        organizationId,
        userId: m.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 1000) ?? null,
        link,
      })),
    );
    return members.length;
  } catch (error) {
    log.error("notification write failed", { component: "notifications", type: input.type, error });
    return 0;
  }
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function personOf(actor: Actor): string {
  if (actor.kind !== "user" || !actor.userId) throw forbidden("Notifications belong to a signed-in person.");
  return actor.userId;
}

/** The acting person's notifications in this workspace, newest first, plus the unread count. */
export async function listNotifications(
  actor: Actor,
  limit = 30,
): Promise<{ notifications: NotificationDto[]; unread: number }> {
  const userId = personOf(actor);
  const mine = and(
    eq(schema.notification.organizationId, actor.organizationId),
    eq(schema.notification.userId, userId),
  );
  const [rows, [counts]] = await Promise.all([
    db
      .select()
      .from(schema.notification)
      .where(mine)
      .orderBy(desc(schema.notification.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100)),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(schema.notification)
      .where(and(mine, isNull(schema.notification.readAt))),
  ]);
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    unread: counts?.unread ?? 0,
  };
}

export const markReadSchema = z
  .object({
    ids: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.ids) !== Boolean(v.all), { message: "Pass either ids or all: true." });

/** Mark the person's own notifications read. An id that isn't theirs (or doesn't exist) is a 404. */
export async function markNotificationsRead(
  actor: Actor,
  input: z.infer<typeof markReadSchema>,
): Promise<{ updated: number }> {
  const userId = personOf(actor);
  const mine = and(
    eq(schema.notification.organizationId, actor.organizationId),
    eq(schema.notification.userId, userId),
  );
  if (input.ids) {
    const ids = [...new Set(input.ids)];
    const owned = await db
      .select({ id: schema.notification.id })
      .from(schema.notification)
      .where(and(mine, inArray(schema.notification.id, ids)));
    if (owned.length !== ids.length) throw notFound("Notification not found.");
  }
  const updated = await db
    .update(schema.notification)
    .set({ readAt: new Date() })
    .where(
      and(mine, isNull(schema.notification.readAt), input.ids ? inArray(schema.notification.id, input.ids) : undefined),
    )
    .returning({ id: schema.notification.id });
  return { updated: updated.length };
}

export interface ActivityDto {
  id: string;
  type: string;
  summary: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  actorName: string | null;
  occurredAt: string;
  /** Where the activity's record lives in the app, when there is one. */
  link: string | null;
}

function recordLink(r: { contactId: string | null; companyId: string | null; dealId: string | null }): string | null {
  if (r.contactId) return `/dashboard/people/${r.contactId}`;
  if (r.companyId) return `/dashboard/companies/${r.companyId}`;
  if (r.dealId) return "/dashboard/deals";
  return null;
}

/** Recent activity across the workspace (the bell's Activities tab). */
export async function recentActivities(actor: Actor, limit = 20): Promise<ActivityDto[]> {
  const rows = await db
    .select({
      id: schema.activity.id,
      type: schema.activity.type,
      summary: schema.activity.summary,
      contactId: schema.activity.contactId,
      companyId: schema.activity.companyId,
      dealId: schema.activity.dealId,
      occurredAt: schema.activity.occurredAt,
      actorName: schema.user.name,
    })
    .from(schema.activity)
    .leftJoin(schema.user, eq(schema.user.id, schema.activity.actorUserId))
    .where(eq(schema.activity.organizationId, actor.organizationId))
    .orderBy(desc(schema.activity.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((r) => ({
    ...r,
    occurredAt: r.occurredAt.toISOString(),
    link: recordLink(r),
  }));
}
