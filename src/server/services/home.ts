import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, notExists, or, sql } from "drizzle-orm";

import { OPEN_DEAL_STAGES } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";

/**
 * Data for the Home layouts (Win & close, Generate pipeline). Every query is scoped to the actor's
 * workspace; "your" widgets are further scoped to the acting person (their mailboxes, tasks, deals).
 */

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function personOf(actor: Actor): string {
  return actor.userId ?? "";
}

export interface EmailStats {
  since: string;
  /** False when the person has no mailbox: the widget asks them to connect one. */
  hasMailbox: boolean;
  sent: number;
  delivered: number;
  /** Null when none of the person's sequences track opens. */
  opened: number | null;
  replied: number;
  interested: number;
  bounced: number;
  bounceRate: number | null;
}

export async function emailStatsThisMonth(actor: Actor): Promise<EmailStats> {
  const org = actor.organizationId;
  const userId = personOf(actor);
  const since = monthStart(new Date());
  const mailboxes = await db
    .select({ id: schema.mailbox.id })
    .from(schema.mailbox)
    .where(and(eq(schema.mailbox.organizationId, org), eq(schema.mailbox.userId, userId)));
  const ids = mailboxes.map((m) => m.id);
  if (!ids.length) {
    return {
      since: since.toISOString(),
      hasMailbox: false,
      sent: 0,
      delivered: 0,
      opened: null,
      replied: 0,
      interested: 0,
      bounced: 0,
      bounceRate: null,
    };
  }

  const [[messages], [tracking], [replies], [opens]] = await Promise.all([
    db
      .select({
        sent: sql<number>`count(*) filter (where ${schema.outboundMessage.status} in ('sent', 'bounced'))::int`,
        bounced: sql<number>`count(*) filter (where ${schema.outboundMessage.status} = 'bounced')::int`,
      })
      .from(schema.outboundMessage)
      .where(
        and(
          eq(schema.outboundMessage.organizationId, org),
          inArray(schema.outboundMessage.mailboxId, ids),
          gte(sql`coalesce(${schema.outboundMessage.sentAt}, ${schema.outboundMessage.createdAt})`, since),
        ),
      ),
    db
      .select({ on: sql<boolean>`bool_or(${schema.sequence.trackOpens})` })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, org), inArray(schema.sequence.mailboxId, ids))),
    db
      .select({
        replied: sql<number>`count(*) filter (where ${schema.enrollment.status} = 'replied')::int`,
        interested: sql<number>`count(*) filter (where ${schema.contact.stage} = 'interested')::int`,
      })
      .from(schema.enrollment)
      .innerJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
      .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
      .where(
        and(
          eq(schema.enrollment.organizationId, org),
          inArray(schema.sequence.mailboxId, ids),
          gte(schema.enrollment.updatedAt, since),
        ),
      ),
    db
      .select({ count: sql<number>`count(distinct ${schema.activity.contactId})::int` })
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.organizationId, org),
          eq(schema.activity.type, "email_opened"),
          gte(schema.activity.occurredAt, since),
        ),
      ),
  ]);

  const sent = messages?.sent ?? 0;
  const bounced = messages?.bounced ?? 0;
  return {
    since: since.toISOString(),
    hasMailbox: true,
    sent,
    delivered: sent - bounced,
    opened: tracking?.on ? (opens?.count ?? 0) : null,
    replied: replies?.replied ?? 0,
    interested: replies?.interested ?? 0,
    bounced,
    bounceRate: sent ? bounced / sent : null,
  };
}

export const REPLY_CATEGORIES = ["interested", "not_interested", "unsubscribed", "uncategorized"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

/** Replies in the last 30 days in the person's sequences, grouped by what the contact's stage says. */
export async function recentRepliesByCategory(actor: Actor): Promise<Record<ReplyCategory, number>> {
  const since = new Date(Date.now() - 30 * 864e5);
  const userId = personOf(actor);
  const rows = await db
    .select({
      category: sql<ReplyCategory>`case
        when ${schema.enrollment.status} = 'unsubscribed' or ${schema.contact.stage} = 'do_not_contact' then 'unsubscribed'
        when ${schema.contact.stage} = 'interested' then 'interested'
        when ${schema.contact.stage} = 'not_interested' then 'not_interested'
        else 'uncategorized' end`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.enrollment)
    .innerJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
    .where(
      and(
        eq(schema.enrollment.organizationId, actor.organizationId),
        inArray(schema.enrollment.status, ["replied", "unsubscribed"]),
        gte(schema.enrollment.updatedAt, since),
        or(eq(schema.sequence.ownerId, userId), eq(schema.sequence.createdById, userId)),
      ),
    )
    .groupBy(sql`1`);
  const result: Record<ReplyCategory, number> = { interested: 0, not_interested: 0, unsubscribed: 0, uncategorized: 0 };
  for (const row of rows) result[row.category] = row.count;
  return result;
}

export interface TaskCounts {
  all: number;
  call: number;
  email: number;
  linkedin: number;
  actionItem: number;
  overdue: number;
}

export async function myTaskCounts(actor: Actor): Promise<TaskCounts> {
  const now = new Date();
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      call: sql<number>`count(*) filter (where ${schema.task.type} = 'call')::int`,
      email: sql<number>`count(*) filter (where ${schema.task.type} = 'email')::int`,
      linkedin: sql<number>`count(*) filter (where ${schema.task.type} like 'linkedin%')::int`,
      actionItem: sql<number>`count(*) filter (where ${schema.task.type} = 'action_item')::int`,
      overdue: sql<number>`count(*) filter (where ${schema.task.dueAt} < ${now})::int`,
    })
    .from(schema.task)
    .where(
      and(
        eq(schema.task.organizationId, actor.organizationId),
        eq(schema.task.assigneeId, personOf(actor)),
        eq(schema.task.status, "open"),
      ),
    );
  return row ?? { all: 0, call: 0, email: 0, linkedin: 0, actionItem: 0, overdue: 0 };
}

export interface FollowUpDeal {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  currency: string;
  closeDate: string | null;
  company: string | null;
  reason: "close_date_passed" | "no_recent_activity";
}

/** Open deals you own whose close date has passed or that have had no activity for 14 days. */
export async function dealsForFollowUp(actor: Actor, limit = 5): Promise<FollowUpDeal[]> {
  const now = new Date();
  const stale = new Date(now.getTime() - 14 * 864e5);
  const recentActivity = db
    .select({ one: sql`1` })
    .from(schema.activity)
    .where(and(eq(schema.activity.dealId, schema.deal.id), gte(schema.activity.occurredAt, stale)));
  const rows = await db
    .select({
      id: schema.deal.id,
      name: schema.deal.name,
      stage: schema.deal.stage,
      amount: schema.deal.amount,
      currency: schema.deal.currency,
      closeDate: schema.deal.closeDate,
      updatedAt: schema.deal.updatedAt,
      company: schema.company.name,
    })
    .from(schema.deal)
    .leftJoin(schema.company, eq(schema.company.id, schema.deal.companyId))
    .where(
      and(
        eq(schema.deal.organizationId, actor.organizationId),
        eq(schema.deal.ownerId, personOf(actor)),
        inArray(schema.deal.stage, [...OPEN_DEAL_STAGES]),
        or(lt(schema.deal.closeDate, now), and(lt(schema.deal.updatedAt, stale), notExists(recentActivity))),
      ),
    )
    .orderBy(asc(schema.deal.closeDate))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    stage: r.stage,
    amount: r.amount,
    currency: r.currency,
    closeDate: r.closeDate?.toISOString() ?? null,
    company: r.company,
    reason: r.closeDate && r.closeDate < now ? "close_date_passed" : "no_recent_activity",
  }));
}

export interface MailboxStatus {
  id: string;
  email: string;
  status: string;
  dailyLimit: number;
  sentToday: number;
}

export async function myMailboxes(actor: Actor): Promise<MailboxStatus[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return db
    .select({
      id: schema.mailbox.id,
      email: schema.mailbox.email,
      status: schema.mailbox.status,
      dailyLimit: schema.mailbox.dailyLimit,
      sentToday: sql<number>`(select count(*)::int from outbound_message m
        where m.mailbox_id = ${schema.mailbox.id} and m.status in ('sent', 'bounced') and m.sent_at >= ${today})`,
    })
    .from(schema.mailbox)
    .where(and(eq(schema.mailbox.organizationId, actor.organizationId), eq(schema.mailbox.userId, personOf(actor))))
    .orderBy(asc(schema.mailbox.email));
}

/* -------------------------------------------------------------------------- */
/* Suggested leads                                                            */
/* -------------------------------------------------------------------------- */

export interface SuggestedPerson {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  score: number;
  reasons: string[];
}

export interface SuggestedCompany {
  id: string;
  name: string;
  industry: string | null;
  employeeCount: number | null;
  reachable: number;
  score: number;
  reasons: string[];
}

const SENIORITY_POINTS = sql<number>`case ${schema.contact.seniority}
  when 'owner' then 30 when 'founder' then 30 when 'c_suite' then 30
  when 'partner' then 25 when 'vp' then 25
  when 'head' then 20 when 'director' then 20
  when 'manager' then 12 when 'senior' then 6 else 0 end`;

const EMAIL_POINTS = sql<number>`case ${schema.contact.emailStatus}
  when 'valid' then 40 when 'catch_all' then 15 else 0 end`;

const EXCLUDED_STAGES = ["do_not_contact", "bad_data", "not_interested", "changed_job"] as const;

/**
 * People worth reaching next: a transparent score (verified email 40, seniority up to 30, not yet
 * engaged 20), excluding anyone enrolled in a sequence, opted out or marked bad data.
 */
export async function suggestedPeople(actor: Actor, limit = 10): Promise<SuggestedPerson[]> {
  const enrolled = db
    .select({ one: sql`1` })
    .from(schema.enrollment)
    .where(eq(schema.enrollment.contactId, schema.contact.id));
  const engagedPoints = sql<number>`case when ${schema.contact.stage} = 'new' then 20 else 0 end`;
  const score = sql<number>`(${EMAIL_POINTS} + ${SENIORITY_POINTS} + ${engagedPoints})::int`;
  const rows = await db
    .select({
      id: schema.contact.id,
      firstName: schema.contact.firstName,
      lastName: schema.contact.lastName,
      title: schema.contact.title,
      email: schema.contact.email,
      emailStatus: schema.contact.emailStatus,
      seniority: schema.contact.seniority,
      stage: schema.contact.stage,
      company: schema.company.name,
      score,
    })
    .from(schema.contact)
    .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
    .where(
      and(
        eq(schema.contact.organizationId, actor.organizationId),
        sql`${schema.contact.stage} not in (${sql.join(
          EXCLUDED_STAGES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        notExists(enrolled),
      ),
    )
    .orderBy(desc(score), asc(schema.contact.lastName))
    .limit(limit);
  return rows
    .filter((r) => r.score > 0)
    .map((r) => {
      const reasons: string[] = [];
      if (r.emailStatus === "valid") reasons.push("Verified email");
      else if (r.emailStatus === "catch_all") reasons.push("Catch-all email");
      if (r.seniority && ["owner", "founder", "c_suite", "partner", "vp", "head", "director"].includes(r.seniority)) {
        reasons.push("Decision maker");
      }
      if (r.stage === "new") reasons.push("Not contacted yet");
      return {
        id: r.id,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Unnamed person",
        title: r.title,
        company: r.company,
        email: r.email,
        score: r.score,
        reasons,
      };
    });
}

/** Companies with the most reachable, not-yet-engaged people. */
export async function suggestedCompanies(actor: Actor, limit = 10): Promise<SuggestedCompany[]> {
  const reachable = sql<number>`(select count(*)::int from contact c
    where c.company_id = ${schema.company.id} and c.email_status = 'valid' and c.stage = 'new'
    and not exists (select 1 from enrollment e where e.contact_id = c.id))`;
  const score = sql<number>`(least(${reachable}, 5) * 12
    + case when ${schema.company.employeeCount} is not null then 10 else 0 end
    + case when ${schema.company.stage} = 'cold' then 10 else 0 end)::int`;
  const rows = await db
    .select({
      id: schema.company.id,
      name: schema.company.name,
      industry: schema.company.industry,
      employeeCount: schema.company.employeeCount,
      stage: schema.company.stage,
      reachable,
      score,
    })
    .from(schema.company)
    .where(
      and(eq(schema.company.organizationId, actor.organizationId), inArray(schema.company.stage, ["cold", "prospect"])),
    )
    .orderBy(desc(score), asc(schema.company.name))
    .limit(limit);
  return rows
    .filter((r) => r.reachable > 0)
    .map((r) => {
      const reasons = [`${r.reachable} reachable ${r.reachable === 1 ? "person" : "people"}`];
      if (r.stage === "cold") reasons.push("Not engaged yet");
      return {
        id: r.id,
        name: r.name,
        industry: r.industry,
        employeeCount: r.employeeCount,
        reachable: r.reachable,
        score: r.score,
        reasons,
      };
    });
}
