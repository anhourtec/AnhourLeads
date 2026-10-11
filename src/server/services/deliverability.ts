import "server-only";

import { and, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";

import { listMailboxes } from "./mailboxes";
import { listSendingDomains } from "./sending-domains";

/**
 * Email setup and health: mailbox performance, the deliverability chart, top sequences,
 * recommendations and the mailbox summary. Definitions used everywhere on the screen:
 * sent = outbound messages with status sent or bounced and a send time; bounced = status bounced;
 * delivered = sent − bounced; replies = contacts emailed from the mailbox(es) who replied
 * (an `email_replied` activity or an enrollment marked replied); positive = `marked_interested`.
 */

export const overviewQuery = z.object({
  mailboxId: z.string().trim().min(1).max(100).optional(),
  days: z.preprocess((v) => (v === undefined || v === "" ? 7 : Number(v)), z.union([z.literal(7), z.literal(30)])),
});

export interface PeriodStats {
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
  opened: number;
  /** delivered / sent, 0–1; null without sends. */
  deliveredRate: number | null;
  replyRate: number | null;
  /** Null when open tracking is off for every sequence on the mailbox(es). */
  openRate: number | null;
}

export interface SeriesPoint {
  date: string;
  sent: number;
  delivered: number;
  bounced: number;
  replied: number;
}

export interface TopSequence {
  id: string;
  name: string;
  status: string;
  sent: number;
  bounced: number;
  contacted: number;
  replied: number;
  replyRate: number | null;
  bounceRate: number | null;
}

export type RecommendationSeverity = "critical" | "warning" | "info";

export interface Recommendation {
  id: string;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  href: string | null;
  action: string | null;
}

export interface MailboxSummary {
  id: string;
  email: string;
  status: string;
  sentToday: number;
  dailyLimit: number;
  sent30: number;
  bounced30: number;
  bounceRate: number | null;
  hasSignature: boolean;
  hasPostalAddress: boolean;
  warmup: "warming" | "ramping" | "not_started";
  warmupStartedAt: string | null;
  sendingWindow: string;
  timezone: string;
}

export interface DeliverabilityOverview {
  mailboxes: { id: string; email: string }[];
  mailboxId: string | null;
  trackingOn: boolean;
  thisMonth: PeriodStats;
  lastMonth: PeriodStats;
  days: 7 | 30;
  series: SeriesPoint[];
  topSequences: TopSequence[];
  recommendations: Recommendation[];
}

const rate = (n: number, d: number) => (d > 0 ? n / d : null);
const num = (v: unknown) => Number(v ?? 0);

function monthBounds(now = new Date()) {
  const thisStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { thisStart, lastStart, now };
}

/** `outbound_message` filter for the workspace and, optionally, one mailbox. */
function scope(org: string, mailboxId: string | null): SQL {
  return mailboxId ? sql`o.organization_id = ${org} and o.mailbox_id = ${mailboxId}` : sql`o.organization_id = ${org}`;
}

async function periodStats(
  org: string,
  mailboxId: string | null,
  from: Date,
  to: Date,
  trackingOn: boolean,
): Promise<PeriodStats> {
  const where = scope(org, mailboxId);
  const result = await db.execute<{
    sent: string;
    bounced: string;
    replies: string;
    positive: string;
    opened: string;
  }>(sql`
    with msgs as (
      select o.contact_id, o.status from outbound_message o
      where ${where} and o.status in ('sent', 'bounced') and o.sent_at is not null
        and o.sent_at >= ${from} and o.sent_at < ${to}
    ),
    emailed as (
      select distinct o.contact_id from outbound_message o
      where ${where} and o.status in ('sent', 'bounced') and o.contact_id is not null
    ),
    replied as (
      select a.contact_id from activity a
      where a.organization_id = ${org} and a.type = 'email_replied'
        and a.occurred_at >= ${from} and a.occurred_at < ${to}
        and a.contact_id in (select contact_id from emailed)
      union
      select e.contact_id from enrollment e
      join outbound_message o on o.enrollment_id = e.id
      where ${where} and e.status = 'replied' and e.updated_at >= ${from} and e.updated_at < ${to}
    )
    select
      (select count(*) from msgs) as sent,
      (select count(*) from msgs where status = 'bounced') as bounced,
      (select count(distinct contact_id) from replied) as replies,
      (select count(distinct a.contact_id) from activity a
        where a.organization_id = ${org} and a.type = 'marked_interested'
          and a.occurred_at >= ${from} and a.occurred_at < ${to}
          and a.contact_id in (select contact_id from emailed)) as positive,
      (select count(distinct a.contact_id) from activity a
        where a.organization_id = ${org} and a.type = 'email_opened'
          and a.occurred_at >= ${from} and a.occurred_at < ${to}
          and a.contact_id in (select contact_id from emailed)) as opened
  `);
  const row = result.rows[0];
  const sent = num(row?.sent);
  const bounced = num(row?.bounced);
  const delivered = Math.max(0, sent - bounced);
  const replies = num(row?.replies);
  const opened = num(row?.opened);
  return {
    sent,
    delivered,
    bounced,
    replies,
    positive: num(row?.positive),
    opened,
    deliveredRate: rate(delivered, sent),
    replyRate: rate(replies, delivered),
    openRate: trackingOn ? rate(opened, delivered) : null,
  };
}

async function series(org: string, mailboxId: string | null, days: number): Promise<SeriesPoint[]> {
  const where = scope(org, mailboxId);
  const result = await db.execute<{ day: string; sent: string; bounced: string; replied: string }>(sql`
    with days as (
      select generate_series(date_trunc('day', now() at time zone 'utc') - (${days - 1} * interval '1 day'),
        date_trunc('day', now() at time zone 'utc'), interval '1 day')::date as day
    ),
    msgs as (
      select (o.sent_at at time zone 'utc')::date as day, o.status from outbound_message o
      where ${where} and o.status in ('sent', 'bounced') and o.sent_at is not null
        and o.sent_at >= now() - (${days} * interval '1 day')
    ),
    emailed as (
      select distinct o.contact_id from outbound_message o
      where ${where} and o.status in ('sent', 'bounced') and o.contact_id is not null
    ),
    replies as (
      select (a.occurred_at at time zone 'utc')::date as day, count(distinct a.contact_id) as n from activity a
      where a.organization_id = ${org} and a.type = 'email_replied'
        and a.occurred_at >= now() - (${days} * interval '1 day')
        and a.contact_id in (select contact_id from emailed)
      group by 1
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*) from msgs m where m.day = d.day) as sent,
      (select count(*) from msgs m where m.day = d.day and m.status = 'bounced') as bounced,
      coalesce((select n from replies r where r.day = d.day), 0) as replied
    from days d order by d.day
  `);
  return result.rows.map((r) => {
    const sent = num(r.sent);
    const bounced = num(r.bounced);
    return { date: r.day, sent, delivered: Math.max(0, sent - bounced), bounced, replied: num(r.replied) };
  });
}

async function topSequences(org: string, mailboxId: string | null, since: Date): Promise<TopSequence[]> {
  const where = scope(org, mailboxId);
  const result = await db.execute<{
    id: string;
    name: string;
    status: string;
    sent: string;
    bounced: string;
    contacted: string;
    replied: string;
  }>(sql`
    select s.id, s.name, s.status,
      count(o.id) as sent,
      count(o.id) filter (where o.status = 'bounced') as bounced,
      count(distinct e.id) as contacted,
      count(distinct e.id) filter (where e.status = 'replied') as replied
    from outbound_message o
    join enrollment e on e.id = o.enrollment_id
    join sequence s on s.id = e.sequence_id
    where ${where} and s.organization_id = ${org} and o.status in ('sent', 'bounced') and o.sent_at >= ${since}
    group by s.id, s.name, s.status
  `);
  return result.rows
    .map((r) => {
      const sent = num(r.sent);
      const contacted = num(r.contacted);
      const replied = num(r.replied);
      const bounced = num(r.bounced);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        sent,
        bounced,
        contacted,
        replied,
        replyRate: rate(replied, contacted),
        bounceRate: rate(bounced, sent),
      };
    })
    .sort((a, b) => (b.replyRate ?? -1) - (a.replyRate ?? -1) || b.sent - a.sent)
    .slice(0, 5);
}

async function trackingOn(org: string, mailboxId: string | null): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.sequence)
    .where(
      and(
        eq(schema.sequence.organizationId, org),
        eq(schema.sequence.trackOpens, true),
        mailboxId ? eq(schema.sequence.mailboxId, mailboxId) : undefined,
      ),
    );
  return (row?.n ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Mailbox summary                                                            */
/* -------------------------------------------------------------------------- */

const RAMP_DAYS = 30;

function warmupState(status: string, ramping: boolean): MailboxSummary["warmup"] {
  if (status === "warming") return "warming";
  return ramping ? "ramping" : "not_started";
}

export async function mailboxSummary(actor: Actor): Promise<MailboxSummary[]> {
  const [views, rows, stats] = await Promise.all([
    listMailboxes(actor),
    db
      .select({
        id: schema.mailbox.id,
        signature: schema.mailbox.signature,
        warmupStartedAt: schema.mailbox.warmupStartedAt,
      })
      .from(schema.mailbox)
      .where(eq(schema.mailbox.organizationId, actor.organizationId)),
    db.execute<{ mailbox_id: string; sent: string; bounced: string }>(sql`
      select o.mailbox_id, count(*) as sent, count(*) filter (where o.status = 'bounced') as bounced
      from outbound_message o
      where o.organization_id = ${actor.organizationId} and o.status in ('sent', 'bounced')
        and o.sent_at >= now() - interval '30 days' and o.mailbox_id is not null
      group by o.mailbox_id
    `),
  ]);
  const extra = new Map(rows.map((r) => [r.id, r]));
  const counts = new Map(stats.rows.map((r) => [r.mailbox_id, r]));
  return views.map((v) => {
    const x = extra.get(v.id);
    const c = counts.get(v.id);
    const sent30 = num(c?.sent);
    const bounced30 = num(c?.bounced);
    const started = x?.warmupStartedAt ?? null;
    const ramping = started && Date.now() - started.getTime() < RAMP_DAYS * 864e5;
    return {
      id: v.id,
      email: v.email,
      status: v.status,
      sentToday: v.sentToday,
      dailyLimit: v.dailyLimit,
      sent30,
      bounced30,
      bounceRate: rate(bounced30, sent30),
      hasSignature: Boolean(x?.signature?.trim()),
      hasPostalAddress: Boolean(v.postalAddress?.trim()),
      warmup: warmupState(v.status, Boolean(ramping)),
      warmupStartedAt: started?.toISOString() ?? null,
      sendingWindow: `${v.sendingWindowStart}–${v.sendingWindowEnd}`,
      timezone: v.timezone,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Recommendations                                                            */
/* -------------------------------------------------------------------------- */

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export async function recommendations(actor: Actor, mailboxes?: MailboxSummary[]): Promise<Recommendation[]> {
  const org = actor.organizationId;
  const out: Recommendation[] = [];
  const canDomains = can(actor.role, "deliverability:read");
  const [domains, boxes, contactStats, unsub, sent30] = await Promise.all([
    canDomains ? listSendingDomains(actor) : Promise.resolve([]),
    mailboxes ? Promise.resolve(mailboxes) : mailboxSummary(actor),
    db.execute<{ with_email: string; catch_all: string }>(sql`
      select count(*) filter (where email is not null) as with_email,
        count(*) filter (where email_status = 'catch_all') as catch_all
      from contact where organization_id = ${org}
    `),
    db.execute<{ n: string }>(
      sql`select count(*) as n from suppression where organization_id = ${org} and reason = 'unsubscribed'`,
    ),
    db.execute<{ sent: string; bounced: string }>(sql`
      select count(*) as sent, count(*) filter (where status = 'bounced') as bounced from outbound_message
      where organization_id = ${org} and status in ('sent', 'bounced') and sent_at >= now() - interval '30 days'
    `),
  ]);

  for (const d of domains) {
    const missing = (["spf", "dkim", "dmarc"] as const).filter((k) => d[k] === "missing" || d[k] === "fail");
    if (missing.length) {
      out.push({
        id: `domain-${d.id}`,
        severity: "critical",
        title: `Fix ${missing.map((m) => m.toUpperCase()).join(", ")} for ${d.domain}`,
        detail:
          "Receivers trust mail more when the sending domain is authenticated. Each check lists the record to add.",
        href: "/dashboard/settings/deliverability?tab=domains",
        action: "Open domains",
      });
    } else if (d.spf === "unknown" && !d.lastCheckedAt) {
      out.push({
        id: `domain-check-${d.id}`,
        severity: "info",
        title: `Check DNS for ${d.domain}`,
        detail: "This domain hasn't been checked yet.",
        href: "/dashboard/settings/deliverability?tab=domains",
        action: "Open domains",
      });
    }
  }
  const outsideHours = (m: MailboxSummary) => {
    const [from = "09:00", to = "17:00"] = m.sendingWindow.split("–");
    return from < "08:00" || to > "18:00";
  };
  const groups: Array<{
    id: string;
    severity: RecommendationSeverity;
    list: MailboxSummary[];
    one: (m: MailboxSummary) => string;
    many: (n: number) => string;
    detail: string;
  }> = [
    {
      id: "postal",
      severity: "critical",
      list: boxes.filter((m) => !m.hasPostalAddress),
      one: (m) => `Add a postal address to ${m.email}`,
      many: (n) => `Add a postal address to ${n} mailboxes`,
      detail: "Every commercial message must identify the sender with a postal address (CAN-SPAM, CASL).",
    },
    {
      id: "signature",
      severity: "warning",
      list: boxes.filter((m) => !m.hasSignature),
      one: (m) => `Add a signature to ${m.email}`,
      many: (n) => `Add a signature to ${n} mailboxes`,
      detail: "Messages with a real signature look personal and help recipients recognise you.",
    },
    {
      id: "window",
      severity: "info",
      list: boxes.filter(outsideHours),
      one: (m) => `Send from ${m.email} during business hours`,
      many: (n) => `Send from ${n} mailboxes during business hours`,
      detail: "Messages sent between 08:00 and 18:00 in the recipient's day get more replies and fewer complaints.",
    },
  ];
  for (const g of groups) {
    const first = g.list[0];
    if (!first) continue;
    const named = g.list.slice(0, 3).map((m) => m.email);
    const more = g.list.length > 3 ? ` and ${g.list.length - 3} more` : "";
    out.push({
      id: g.id,
      severity: g.severity,
      title: g.list.length === 1 ? g.one(first) : g.many(g.list.length),
      detail: g.list.length === 1 ? g.detail : `${g.detail} Mailboxes: ${named.join(", ")}${more}.`,
      href: "/dashboard/mailboxes",
      action: "Open mailboxes",
    });
  }
  const s = sent30.rows[0];
  const sent = num(s?.sent);
  const bounced = num(s?.bounced);
  if (sent >= 20 && bounced / sent > 0.03) {
    out.push({
      id: "bounce-rate",
      severity: "critical",
      title: `Bounce rate is ${pct(bounced / sent)} over the last 30 days`,
      detail: "Keep it under 3%. Verify addresses before sending and remove ones that bounced.",
      href: "/dashboard/settings/deliverability?tab=protection",
      action: "Review bounce logs",
    });
  }
  const c = contactStats.rows[0];
  const withEmail = num(c?.with_email);
  const catchAll = num(c?.catch_all);
  if (withEmail >= 10 && catchAll / withEmail > 0.2) {
    out.push({
      id: "catch-all",
      severity: "warning",
      title: `${pct(catchAll / withEmail)} of your contacts are on catch-all domains`,
      detail:
        "Catch-all domains accept every address, so delivery can't be confirmed in advance. Keep catch-all restriction on.",
      href: "/dashboard/settings/deliverability?tab=protection",
      action: "Sending protection",
    });
  }
  if (sent > 0 && num(unsub.rows[0]?.n) === 0) {
    out.push({
      id: "unsubscribes",
      severity: "info",
      title: "No unsubscribes processed yet: check your unsubscribe link",
      detail: "Every message carries a one-click unsubscribe link. Send a test to yourself and make sure it works.",
      href: "/dashboard/settings/do-not-contact",
      action: "Do not contact",
    });
  }
  const order: Record<RecommendationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export async function deliverabilityOverview(
  actor: Actor,
  input: z.infer<typeof overviewQuery>,
): Promise<DeliverabilityOverview> {
  const org = actor.organizationId;
  const boxes = await mailboxSummary(actor);
  const mailboxId = input.mailboxId ?? null;
  if (mailboxId && !boxes.some((b) => b.id === mailboxId)) throw notFound("Mailbox not found.");
  const { thisStart, lastStart, now } = monthBounds();
  const tracking = await trackingOn(org, mailboxId);
  const [thisMonth, lastMonth, points, top, recs] = await Promise.all([
    periodStats(org, mailboxId, thisStart, new Date(now.getTime() + 1000), tracking),
    periodStats(org, mailboxId, lastStart, thisStart, tracking),
    series(org, mailboxId, input.days),
    topSequences(org, mailboxId, new Date(now.getTime() - 30 * 864e5)),
    recommendations(actor, boxes),
  ]);
  return {
    mailboxes: boxes.map((b) => ({ id: b.id, email: b.email })),
    mailboxId,
    trackingOn: tracking,
    thisMonth,
    lastMonth,
    days: input.days,
    series: points,
    topSequences: top,
    recommendations: recs,
  };
}
