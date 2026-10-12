import "server-only";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { can } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";

import { USAGE_ACTION } from "./usage-events";

/**
 * Usage & activity (the equivalent of a credits page, without credits): what each person and the
 * workspace used this month and last month. Lookups come from the `usage.lookup` audit entries the
 * enrichment endpoints write; cached lookups are counted separately because they cost nothing.
 * Everyone sees their own usage; people with `audit:read` also see the workspace and every member.
 */

export const USAGE_COUNTERS = [
  "peopleLookups",
  "companyLookups",
  "emailVerifications",
  "csvRows",
  "cachedLookups",
  "crawlPages",
  "emailsSent",
  "aiMessages",
] as const;
export type UsageCounter = (typeof USAGE_COUNTERS)[number];
export type UsageCounts = Record<UsageCounter, number>;

export const USAGE_LABELS: Record<UsageCounter, string> = {
  peopleLookups: "People lookups",
  companyLookups: "Company lookups",
  emailVerifications: "Email verifications",
  csvRows: "CSV rows enriched",
  cachedLookups: "Cached lookups (free)",
  crawlPages: "Pages crawled",
  emailsSent: "Emails sent",
  aiMessages: "AI messages",
};

export interface UsageUserRow {
  userId: string;
  name: string;
  email: string;
  thisMonth: UsageCounts;
  lastMonth: UsageCounts;
}

export interface DataRequest {
  id: string;
  action: "export" | "erase";
  actorName: string | null;
  createdAt: string;
}

export interface UsageReport {
  period: { thisMonth: { from: string; to: string }; lastMonth: { from: string; to: string } };
  me: { thisMonth: UsageCounts; lastMonth: UsageCounts };
  /** Only for people with audit:read. */
  workspace: { thisMonth: UsageCounts; lastMonth: UsageCounts } | null;
  users: UsageUserRow[] | null;
  dataRequests: DataRequest[] | null;
}

const empty = (): UsageCounts => Object.fromEntries(USAGE_COUNTERS.map((k) => [k, 0])) as UsageCounts;

interface Window {
  from: Date;
  to: Date;
}

const UNKNOWN = "__none__";

type PerUser = Map<string, UsageCounts>;

function bump(map: PerUser, userId: string | null, key: UsageCounter, n: number) {
  const id = userId ?? UNKNOWN;
  const row = map.get(id) ?? empty();
  row[key] += n;
  map.set(id, row);
}

/** All counters for one window, keyed by user id (UNKNOWN for system / deleted users). */
async function countsByUser(org: string, w: Window): Promise<PerUser> {
  const map: PerUser = new Map();
  const [lookups, pages, sent, ai] = await Promise.all([
    db
      .select({ userId: schema.auditLog.actorUserId, metadata: schema.auditLog.metadata })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, org),
          eq(schema.auditLog.action, USAGE_ACTION),
          gte(schema.auditLog.createdAt, w.from),
          lt(schema.auditLog.createdAt, w.to),
        ),
      ),
    db
      .select({ userId: schema.crawlJob.createdById, n: sql<number>`count(*)::int` })
      .from(schema.crawlPage)
      .innerJoin(schema.crawlJob, eq(schema.crawlJob.id, schema.crawlPage.jobId))
      .where(
        and(
          eq(schema.crawlJob.organizationId, org),
          sql`${schema.crawlPage.skippedReason} is null`,
          gte(schema.crawlPage.fetchedAt, w.from),
          lt(schema.crawlPage.fetchedAt, w.to),
        ),
      )
      .groupBy(schema.crawlJob.createdById),
    db
      .select({ userId: schema.mailbox.userId, n: sql<number>`count(*)::int` })
      .from(schema.outboundMessage)
      .leftJoin(schema.mailbox, eq(schema.mailbox.id, schema.outboundMessage.mailboxId))
      .where(
        and(
          eq(schema.outboundMessage.organizationId, org),
          inArray(schema.outboundMessage.status, ["sent", "bounced"]),
          gte(schema.outboundMessage.sentAt, w.from),
          lt(schema.outboundMessage.sentAt, w.to),
        ),
      )
      .groupBy(schema.mailbox.userId),
    db
      .select({ userId: schema.aiChat.userId, n: sql<number>`count(*)::int` })
      .from(schema.aiMessage)
      .innerJoin(schema.aiChat, eq(schema.aiChat.id, schema.aiMessage.chatId))
      .where(
        and(
          eq(schema.aiChat.organizationId, org),
          eq(schema.aiMessage.role, "user"),
          gte(schema.aiMessage.createdAt, w.from),
          lt(schema.aiMessage.createdAt, w.to),
        ),
      )
      .groupBy(schema.aiChat.userId),
  ]);

  for (const row of lookups) {
    const meta = (row.metadata ?? {}) as { counts?: Record<string, unknown>; cached?: unknown };
    const counts = meta.counts ?? {};
    const num = (k: string) => (typeof counts[k] === "number" ? (counts[k] as number) : 0);
    bump(map, row.userId, "peopleLookups", num("contact_match") + num("pattern_detection"));
    bump(map, row.userId, "companyLookups", num("company_match") + num("website_crawl"));
    bump(map, row.userId, "emailVerifications", num("email_verification"));
    bump(map, row.userId, "csvRows", num("csv_enrichment_row"));
    bump(map, row.userId, "cachedLookups", typeof meta.cached === "number" ? meta.cached : 0);
  }
  for (const r of pages) bump(map, r.userId, "crawlPages", r.n);
  for (const r of sent) bump(map, r.userId, "emailsSent", r.n);
  for (const r of ai) bump(map, r.userId, "aiMessages", r.n);
  return map;
}

function sum(map: PerUser): UsageCounts {
  const out = empty();
  for (const row of map.values()) for (const k of USAGE_COUNTERS) out[k] += row[k];
  return out;
}

export function monthWindows(now = new Date()): { thisMonth: Window; lastMonth: Window } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { thisMonth: { from: start, to: next }, lastMonth: { from: prev, to: start } };
}

export async function getUsage(actor: Actor, now = new Date()): Promise<UsageReport> {
  const org = actor.organizationId;
  const windows = monthWindows(now);
  const [current, previous] = await Promise.all([
    countsByUser(org, windows.thisMonth),
    countsByUser(org, windows.lastMonth),
  ]);
  const mine = (map: PerUser) => (actor.userId ? (map.get(actor.userId) ?? empty()) : empty());
  const period = {
    thisMonth: { from: windows.thisMonth.from.toISOString(), to: windows.thisMonth.to.toISOString() },
    lastMonth: { from: windows.lastMonth.from.toISOString(), to: windows.lastMonth.to.toISOString() },
  };
  const me = { thisMonth: mine(current), lastMonth: mine(previous) };
  if (!can(actor.role, "audit:read")) {
    return { period, me, workspace: null, users: null, dataRequests: null };
  }

  const [members, requests] = await Promise.all([
    db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, org))
      .orderBy(schema.user.name),
    db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        actorName: schema.user.name,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorUserId))
      .where(
        and(
          eq(schema.auditLog.organizationId, org),
          inArray(schema.auditLog.action, ["privacy.export", "privacy.erase"]),
          gte(schema.auditLog.createdAt, windows.lastMonth.from),
        ),
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(50),
  ]);

  return {
    period,
    me,
    workspace: { thisMonth: sum(current), lastMonth: sum(previous) },
    users: members.map((m) => ({
      userId: m.id,
      name: m.name,
      email: m.email,
      thisMonth: current.get(m.id) ?? empty(),
      lastMonth: previous.get(m.id) ?? empty(),
    })),
    dataRequests: requests.map((r) => ({
      id: r.id,
      action: r.action === "privacy.erase" ? "erase" : "export",
      actorName: r.actorName,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
