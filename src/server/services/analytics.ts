import "server-only";

import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { DEAL_STAGE_INFO, type DealStage } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";

/**
 * Workspace analytics: one whitelisted metric, grouped by time or by a dimension, over a date range.
 * Every query is built from fixed SQL fragments (no user text reaches SQL except bound values) and
 * filtered by the actor's workspace, so nothing from another workspace is ever aggregated.
 *
 * Definitions (docs/reference/apollo-ui.md §13):
 * - Emails sent: outbound messages with status sent or bounced, by sentAt. Bounced: status bounced.
 *   Delivered: sent minus bounced (status sent). Blocked: held back before sending, by createdAt.
 * - Replies, opens, positive replies and calls: activity rows (email_replied, email_opened,
 *   marked_interested, call_logged) by occurredAt. The rep is the activity's actor, else the owner of
 *   the mailbox named in metadata.mailboxId; sequence and mailbox come from metadata.sequenceId /
 *   metadata.mailboxId.
 * - Tasks completed: completed tasks by completedAt, per assignee.
 * - Deals won / lost: closed deals by close date (else last update), per owner. Open pipeline value
 *   is a snapshot of open deals now; the date range doesn't apply to it.
 * - Enrichment jobs / rows: enrichment_job rows by createdAt (rows = processed). Verified emails:
 *   contacts whose address verified as valid, by emailVerifiedAt.
 */

export const ANALYTICS_METRICS = [
  "emails_sent",
  "emails_delivered",
  "emails_bounced",
  "emails_replied",
  "emails_opened",
  "positive_replies",
  "emails_blocked",
  "calls_logged",
  "tasks_completed",
  "contacts_created",
  "companies_created",
  "deals_created",
  "deals_won",
  "deals_lost",
  "deals_won_value",
  "open_pipeline_value",
  "enrichment_jobs",
  "enrichment_rows",
  "verified_emails",
] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

export const ANALYTICS_GROUP_BYS = ["none", "day", "week", "month", "rep", "sequence", "mailbox", "stage"] as const;
export type AnalyticsGroupBy = (typeof ANALYTICS_GROUP_BYS)[number];

export interface AnalyticsFilters {
  userId?: string;
  sequenceId?: string;
  mailboxId?: string;
}

export interface AnalyticsQuery {
  metric: AnalyticsMetric;
  groupBy: AnalyticsGroupBy;
  from: Date;
  to: Date;
  filters?: AnalyticsFilters;
}

export interface AnalyticsRow {
  key: string;
  label: string;
  value: number;
}

export interface AnalyticsResult {
  metric: AnalyticsMetric;
  label: string;
  groupBy: AnalyticsGroupBy;
  from: string;
  to: string;
  rows: AnalyticsRow[];
  total: number;
}

export const METRIC_LABELS: Record<AnalyticsMetric, string> = {
  emails_sent: "Emails sent",
  emails_delivered: "Emails delivered",
  emails_bounced: "Emails bounced",
  emails_replied: "Replies",
  emails_opened: "Opens",
  positive_replies: "Positive replies",
  emails_blocked: "Emails held back",
  calls_logged: "Calls logged",
  tasks_completed: "Tasks completed",
  contacts_created: "People added",
  companies_created: "Companies added",
  deals_created: "Deals created",
  deals_won: "Deals won",
  deals_lost: "Deals lost",
  deals_won_value: "Won value",
  open_pipeline_value: "Open pipeline value",
  enrichment_jobs: "Enrichment jobs",
  enrichment_rows: "Rows enriched",
  verified_emails: "Emails verified as valid",
};

export const GROUP_BY_LABELS: Record<AnalyticsGroupBy, string> = {
  none: "Total",
  day: "Day",
  week: "Week",
  month: "Month",
  rep: "Rep",
  sequence: "Sequence",
  mailbox: "Mailbox",
  stage: "Stage",
};

/** Metrics whose value is money (formatted as currency in the UI). */
export const CURRENCY_METRICS: ReadonlySet<AnalyticsMetric> = new Set(["deals_won_value", "open_pipeline_value"]);

type Dimension = "rep" | "sequence" | "mailbox" | "stage";

interface MetricSource {
  from: SQL;
  where: SQL;
  /** Null for snapshot metrics (no time grouping, range ignored). */
  time: SQL | null;
  value: SQL;
  dims: Partial<Record<Dimension, SQL>>;
}

const TIME_GROUPS = new Set<AnalyticsGroupBy>(["day", "week", "month"]);

function outbound(org: string, status: SQL, time: "sent" | "created"): MetricSource {
  return {
    from: sql`outbound_message o left join mailbox m on m.id = o.mailbox_id left join enrollment e on e.id = o.enrollment_id`,
    where: sql`o.organization_id = ${org} and ${status}${time === "sent" ? sql` and o.sent_at is not null` : sql``}`,
    time: time === "sent" ? sql`o.sent_at` : sql`o.created_at`,
    value: sql`count(*)`,
    dims: { rep: sql`m.user_id`, sequence: sql`e.sequence_id`, mailbox: sql`o.mailbox_id` },
  };
}

function activityOf(org: string, type: string, withMessageDims: boolean): MetricSource {
  return {
    from: sql`activity a left join mailbox am on am.id = (a.metadata->>'mailboxId') and am.organization_id = a.organization_id`,
    where: sql`a.organization_id = ${org} and a.type = ${type}`,
    time: sql`a.occurred_at`,
    value: sql`count(*)`,
    dims: withMessageDims
      ? {
          rep: sql`coalesce(a.actor_user_id, am.user_id)`,
          sequence: sql`(a.metadata->>'sequenceId')`,
          mailbox: sql`(a.metadata->>'mailboxId')`,
        }
      : { rep: sql`coalesce(a.actor_user_id, am.user_id)` },
  };
}

const DEAL_FROM = sql`deal d left join pipeline_stage ps on ps.id = d.stage_id`;
const DEAL_STAGE_KEY = sql`coalesce(d.stage_id, d.stage)`;
const dealIs = (type: "won" | "lost") => sql`(ps.type = ${type} or (ps.id is null and d.stage = ${type}))`;
const DEAL_OPEN = sql`(coalesce(ps.type, case when d.stage in ('won','lost') then d.stage else 'open' end) = 'open')`;

function sourceFor(metric: AnalyticsMetric, org: string): MetricSource {
  switch (metric) {
    case "emails_sent":
      return outbound(org, sql`o.status in ('sent','bounced')`, "sent");
    case "emails_delivered":
      return outbound(org, sql`o.status = 'sent'`, "sent");
    case "emails_bounced":
      return outbound(org, sql`o.status = 'bounced'`, "sent");
    case "emails_blocked":
      return outbound(org, sql`o.status = 'blocked'`, "created");
    case "emails_replied":
      return activityOf(org, "email_replied", true);
    case "emails_opened":
      return activityOf(org, "email_opened", true);
    case "positive_replies":
      return activityOf(org, "marked_interested", true);
    case "calls_logged":
      return activityOf(org, "call_logged", false);
    case "tasks_completed":
      return {
        from: sql`task t`,
        where: sql`t.organization_id = ${org} and t.status = 'completed' and t.completed_at is not null`,
        time: sql`t.completed_at`,
        value: sql`count(*)`,
        dims: { rep: sql`t.assignee_id` },
      };
    case "contacts_created":
      return {
        from: sql`contact c`,
        where: sql`c.organization_id = ${org}`,
        time: sql`c.created_at`,
        value: sql`count(*)`,
        dims: { rep: sql`c.owner_id`, stage: sql`c.stage` },
      };
    case "companies_created":
      return {
        from: sql`company co`,
        where: sql`co.organization_id = ${org}`,
        time: sql`co.created_at`,
        value: sql`count(*)`,
        dims: { rep: sql`co.owner_id`, stage: sql`co.stage` },
      };
    case "deals_created":
      return {
        from: DEAL_FROM,
        where: sql`d.organization_id = ${org}`,
        time: sql`d.created_at`,
        value: sql`count(*)`,
        dims: { rep: sql`d.owner_id`, stage: DEAL_STAGE_KEY },
      };
    case "deals_won":
    case "deals_lost":
    case "deals_won_value":
      return {
        from: DEAL_FROM,
        where: sql`d.organization_id = ${org} and ${dealIs(metric === "deals_lost" ? "lost" : "won")}`,
        time: sql`coalesce(d.close_date, d.updated_at)`,
        value: metric === "deals_won_value" ? sql`coalesce(sum(d.amount), 0)` : sql`count(*)`,
        dims: { rep: sql`d.owner_id`, stage: DEAL_STAGE_KEY },
      };
    case "open_pipeline_value":
      return {
        from: DEAL_FROM,
        where: sql`d.organization_id = ${org} and ${DEAL_OPEN}`,
        time: null,
        value: sql`coalesce(sum(d.amount), 0)`,
        dims: { rep: sql`d.owner_id`, stage: DEAL_STAGE_KEY },
      };
    case "enrichment_jobs":
    case "enrichment_rows":
      return {
        from: sql`enrichment_job j`,
        where: sql`j.organization_id = ${org}`,
        time: sql`j.created_at`,
        value: metric === "enrichment_rows" ? sql`coalesce(sum(j.processed), 0)` : sql`count(*)`,
        dims: { rep: sql`j.created_by_id` },
      };
    case "verified_emails":
      return {
        from: sql`contact c`,
        where: sql`c.organization_id = ${org} and c.email_status = 'valid' and c.email_verified_at is not null`,
        time: sql`c.email_verified_at`,
        value: sql`count(*)`,
        dims: { rep: sql`c.owner_id` },
      };
  }
}

/** Which groupings a metric supports (shown in the report builder and enforced by the API). */
export function groupBysFor(metric: AnalyticsMetric): AnalyticsGroupBy[] {
  const source = sourceFor(metric, "");
  const out: AnalyticsGroupBy[] = ["none"];
  if (source.time) out.push("day", "week", "month");
  for (const d of ["rep", "sequence", "mailbox", "stage"] as const) if (source.dims[d]) out.push(d);
  return out;
}

export const METRIC_GROUP_BYS: Record<AnalyticsMetric, AnalyticsGroupBy[]> = Object.fromEntries(
  ANALYTICS_METRICS.map((m) => [m, groupBysFor(m)]),
) as Record<AnalyticsMetric, AnalyticsGroupBy[]>;

const unprocessable = (path: string, message: string) =>
  new HttpError(422, "Some fields are invalid.", [{ path, message }]);

const MAX_RANGE_DAYS = 731;
const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Use an ISO date, e.g. 2026-10-31." })
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v)));

const optionalId = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((v) => v || undefined);

/** Query-string input for GET /api/v1/analytics/query. `to` given as a date covers that whole day. */
export const analyticsQueryInput = z
  .object({
    metric: z.enum(ANALYTICS_METRICS, { message: "Pick a metric from the catalogue." }),
    groupBy: z
      .enum(ANALYTICS_GROUP_BYS, { message: "Group by none, day, week, month, rep, sequence, mailbox or stage." })
      .default("none"),
    from: isoDate.optional(),
    to: z
      .string()
      .trim()
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Use an ISO date, e.g. 2026-10-31." })
      .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999Z`) : new Date(v)))
      .optional(),
    userId: optionalId,
    sequenceId: optionalId,
    mailboxId: optionalId,
  })
  .transform((v): AnalyticsQuery => {
    const to = v.to ?? new Date();
    const from = v.from ?? new Date(to.getTime() - 30 * DAY_MS);
    return {
      metric: v.metric,
      groupBy: v.groupBy,
      from,
      to,
      filters: { userId: v.userId, sequenceId: v.sequenceId, mailboxId: v.mailboxId },
    };
  });

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

function bucketExpr(groupBy: "day" | "week" | "month", time: SQL): SQL {
  const unit = sql.raw(`'${groupBy}'`);
  return sql`to_char(date_trunc(${unit}, ${time} at time zone 'UTC'), 'YYYY-MM-DD')`;
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bucketStart(groupBy: "day" | "week" | "month", date: Date): Date {
  const d = utcDay(date);
  if (groupBy === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0, like date_trunc('week')
    return new Date(d.getTime() - dow * DAY_MS);
  }
  if (groupBy === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return d;
}

function nextBucket(groupBy: "day" | "week" | "month", d: Date): Date {
  if (groupBy === "day") return new Date(d.getTime() + DAY_MS);
  if (groupBy === "week") return new Date(d.getTime() + 7 * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

const isoKey = (d: Date) => d.toISOString().slice(0, 10);

function bucketLabel(groupBy: "day" | "week" | "month", key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (groupBy === "month") return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return groupBy === "week" ? `Week of ${label}` : label;
}

const CONTACT_STAGE_LABELS: Record<string, string> = {
  new: "Cold",
  contacted: "Approaching",
  replied: "Replied",
  interested: "Interested",
  not_interested: "Not interested",
  unresponsive: "Unresponsive",
  do_not_contact: "Do not contact",
  bad_data: "Bad data",
  changed_job: "Changed job",
  cold: "Cold",
  prospect: "Prospect",
  engaged: "Engaged",
  customer: "Customer",
  churned: "Churned",
};

async function labelsFor(org: string, dim: Dimension, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  if (dim === "rep") {
    const rows = await db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
      .where(and(eq(schema.member.organizationId, org), inArray(schema.user.id, keys)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (dim === "sequence") {
    const rows = await db
      .select({ id: schema.sequence.id, name: schema.sequence.name })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, org), inArray(schema.sequence.id, keys)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (dim === "mailbox") {
    const rows = await db
      .select({ id: schema.mailbox.id, email: schema.mailbox.email })
      .from(schema.mailbox)
      .where(and(eq(schema.mailbox.organizationId, org), inArray(schema.mailbox.id, keys)));
    for (const r of rows) out.set(r.id, r.email);
  } else {
    const rows = await db
      .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
      .from(schema.pipelineStage)
      .innerJoin(schema.pipeline, eq(schema.pipeline.id, schema.pipelineStage.pipelineId))
      .where(and(eq(schema.pipeline.organizationId, org), inArray(schema.pipelineStage.id, keys)));
    for (const r of rows) out.set(r.id, r.name);
    for (const k of keys) {
      if (out.has(k)) continue;
      const deal = (DEAL_STAGE_INFO as Record<string, { name: string } | undefined>)[k as DealStage];
      out.set(k, deal?.name ?? CONTACT_STAGE_LABELS[k] ?? k);
    }
  }
  return out;
}

const NONE_LABEL: Record<Dimension, string> = {
  rep: "Unassigned",
  sequence: "No sequence",
  mailbox: "No mailbox",
  stage: "No stage",
};

async function assertFilters(actor: Actor, filters: AnalyticsFilters): Promise<void> {
  const org = actor.organizationId;
  if (filters.userId) {
    const [row] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, org), eq(schema.member.userId, filters.userId)))
      .limit(1);
    if (!row) throw notFound("Rep not found.");
  }
  if (filters.sequenceId) {
    const [row] = await db
      .select({ id: schema.sequence.id })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, org), eq(schema.sequence.id, filters.sequenceId)))
      .limit(1);
    if (!row) throw notFound("Sequence not found.");
  }
  if (filters.mailboxId) {
    const [row] = await db
      .select({ id: schema.mailbox.id })
      .from(schema.mailbox)
      .where(and(eq(schema.mailbox.organizationId, org), eq(schema.mailbox.id, filters.mailboxId)))
      .limit(1);
    if (!row) throw notFound("Mailbox not found.");
  }
}

export async function queryAnalytics(actor: Actor, q: AnalyticsQuery): Promise<AnalyticsResult> {
  if (!(ANALYTICS_METRICS as readonly string[]).includes(q.metric))
    throw unprocessable("metric", "Pick a metric from the catalogue.");
  if (!(ANALYTICS_GROUP_BYS as readonly string[]).includes(q.groupBy))
    throw unprocessable("groupBy", "Pick a grouping.");
  if (Number.isNaN(q.from.getTime()) || Number.isNaN(q.to.getTime())) throw unprocessable("from", "Use valid dates.");
  if (q.from > q.to) throw unprocessable("from", "The start date must be before the end date.");
  if (q.to.getTime() - q.from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw unprocessable("from", "Pick a range of two years or less.");
  }
  const source = sourceFor(q.metric, actor.organizationId);
  const supported = groupBysFor(q.metric);
  if (!supported.includes(q.groupBy)) {
    throw unprocessable(
      "groupBy",
      `${METRIC_LABELS[q.metric]} can't be grouped by ${GROUP_BY_LABELS[q.groupBy].toLowerCase()}.`,
    );
  }
  const filters = q.filters ?? {};
  const filterDims: Array<[Dimension, string | undefined, string]> = [
    ["rep", filters.userId, "userId"],
    ["sequence", filters.sequenceId, "sequenceId"],
    ["mailbox", filters.mailboxId, "mailboxId"],
  ];
  for (const [dim, value, path] of filterDims) {
    if (value && !source.dims[dim]) {
      throw unprocessable(path, `${METRIC_LABELS[q.metric]} can't be filtered by ${dim}.`);
    }
  }
  await assertFilters(actor, filters);

  const where: SQL[] = [source.where];
  if (source.time) where.push(sql`${source.time} >= ${q.from} and ${source.time} <= ${q.to}`);
  for (const [dim, value] of filterDims) {
    const expr = source.dims[dim];
    if (value && expr) where.push(sql`${expr} = ${value}`);
  }

  let keyExpr: SQL = sql`'total'`;
  if (TIME_GROUPS.has(q.groupBy) && source.time) {
    keyExpr = bucketExpr(q.groupBy as "day" | "week" | "month", source.time);
  } else if (q.groupBy !== "none") {
    keyExpr = source.dims[q.groupBy as Dimension] ?? sql`null`;
  }

  const result = await db.execute<{ key: string | null; value: string | number | null }>(
    sql`select ${keyExpr} as key, ${source.value} as value from ${source.from} where ${sql.join(where, sql` and `)} group by 1`,
  );
  const raw = result.rows.map((r) => ({ key: r.key, value: Number(r.value ?? 0) }));

  let rows: AnalyticsRow[];
  if (q.groupBy === "none") {
    const value = raw.reduce((s, r) => s + r.value, 0);
    rows = [{ key: "total", label: METRIC_LABELS[q.metric], value }];
  } else if (TIME_GROUPS.has(q.groupBy)) {
    const g = q.groupBy as "day" | "week" | "month";
    const byKey = new Map(raw.map((r) => [r.key ?? "", r.value]));
    rows = [];
    for (let d = bucketStart(g, q.from); d <= q.to; d = nextBucket(g, d)) {
      const key = isoKey(d);
      rows.push({ key, label: bucketLabel(g, key), value: byKey.get(key) ?? 0 });
    }
  } else {
    const dim = q.groupBy as Dimension;
    const labels = await labelsFor(
      actor.organizationId,
      dim,
      raw.flatMap((r) => (r.key ? [r.key] : [])),
    );
    rows = raw
      .map((r) => ({
        key: r.key ?? "none",
        label: r.key ? (labels.get(r.key) ?? (dim === "rep" ? "Former member" : r.key)) : NONE_LABEL[dim],
        value: r.value,
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  return {
    metric: q.metric,
    label: METRIC_LABELS[q.metric],
    groupBy: q.groupBy,
    from: q.from.toISOString(),
    to: q.to.toISOString(),
    rows,
    total: rows.reduce((s, r) => s + r.value, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Date ranges for widgets                                                    */
/* -------------------------------------------------------------------------- */

export const WIDGET_RANGES = ["7d", "30d", "90d", "this_month", "last_month"] as const;
export type WidgetRange = (typeof WIDGET_RANGES)[number];

export const RANGE_LABELS: Record<WidgetRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
};

export function rangeDates(range: WidgetRange, now = new Date()): { from: Date; to: Date } {
  const today = utcDay(now);
  switch (range) {
    case "7d":
      return { from: new Date(today.getTime() - 6 * DAY_MS), to: now };
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY_MS), to: now };
    case "90d":
      return { from: new Date(today.getTime() - 89 * DAY_MS), to: now };
    case "this_month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
    case "last_month":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1),
      };
  }
}

/** Options for the report builder's filters, all from the actor's workspace. */
export async function analyticsFilterOptions(actor: Actor) {
  const org = actor.organizationId;
  const [reps, sequences, mailboxes] = await Promise.all([
    db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, org))
      .orderBy(schema.user.name),
    db
      .select({ id: schema.sequence.id, name: schema.sequence.name })
      .from(schema.sequence)
      .where(eq(schema.sequence.organizationId, org))
      .orderBy(schema.sequence.name)
      .limit(500),
    db
      .select({ id: schema.mailbox.id, name: schema.mailbox.email })
      .from(schema.mailbox)
      .where(eq(schema.mailbox.organizationId, org))
      .orderBy(schema.mailbox.email),
  ]);
  return { reps, sequences, mailboxes };
}
export type AnalyticsFilterOptions = Awaited<ReturnType<typeof analyticsFilterOptions>>;
