import "server-only";

import { and, asc, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type Actor, requirePermission } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import { log } from "@/server/log";

import {
  ANALYTICS_GROUP_BYS,
  ANALYTICS_METRICS,
  type AnalyticsGroupBy,
  type AnalyticsMetric,
  groupBysFor,
  METRIC_LABELS,
  queryAnalytics,
  rangeDates,
  WIDGET_RANGES,
  type WidgetRange,
} from "./analytics";
import { audit } from "./audit";
import { randomUUID } from "node:crypto";

/**
 * Analytics dashboards. Five system dashboards are created lazily per workspace the first time
 * anyone opens analytics; custom dashboards are made by people with `dashboard:manage`. A custom
 * dashboard is visible to its owner, and to everyone when shared. System dashboards can be starred
 * but not renamed, edited or deleted.
 */

export const WIDGET_TYPES = ["kpi", "bar", "line", "table"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  metric: AnalyticsMetric;
  /** Extra series / columns (bar, line, table), at most 3 more than `metric`. */
  metrics?: AnalyticsMetric[];
  groupBy: AnalyticsGroupBy;
  range: WidgetRange;
}

const metricEnum = z.enum(ANALYTICS_METRICS, { message: "Pick a metric from the catalogue." });

export const widgetSchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    type: z.enum(WIDGET_TYPES, { message: "Pick KPI, bar, line or table." }),
    title: z.string().trim().max(120).optional(),
    metric: metricEnum,
    metrics: z.array(metricEnum).max(3).optional(),
    groupBy: z.enum(ANALYTICS_GROUP_BYS).default("none"),
    range: z.enum(WIDGET_RANGES).default("30d"),
  })
  .strict()
  .superRefine((w, ctx) => {
    for (const metric of [w.metric, ...(w.metrics ?? [])]) {
      if (!groupBysFor(metric).includes(w.groupBy)) {
        ctx.addIssue({
          code: "custom",
          path: ["groupBy"],
          message: `${METRIC_LABELS[metric]} can't be grouped this way.`,
        });
        return;
      }
    }
    if ((w.type === "line" || w.type === "bar") && w.groupBy === "none") {
      ctx.addIssue({ code: "custom", path: ["groupBy"], message: "Charts need a grouping, such as day or rep." });
    }
  })
  .transform(
    (w): Widget => ({
      id: w.id ?? randomUUID(),
      type: w.type,
      title: w.title || METRIC_LABELS[w.metric],
      metric: w.metric,
      ...(w.metrics?.length ? { metrics: [...new Set(w.metrics)].filter((m) => m !== w.metric) } : {}),
      groupBy: w.groupBy,
      range: w.range,
    }),
  );

export const createDashboardInput = z
  .object({
    name: z.string().trim().min(1, "Give the dashboard a name.").max(120),
    widgets: z.array(widgetSchema).max(24).optional(),
    shared: z.boolean().optional(),
    starred: z.boolean().optional(),
  })
  .strict();

export const updateDashboardInput = z
  .object({
    name: z.string().trim().min(1, "Give the dashboard a name.").max(120).optional(),
    widgets: z.array(widgetSchema).max(24).optional(),
    shared: z.boolean().optional(),
    starred: z.boolean().optional(),
  })
  .strict();

type DashboardRow = typeof schema.dashboard.$inferSelect;

export interface DashboardDto {
  id: string;
  name: string;
  kind: "system" | "custom" | "home";
  ownerId: string | null;
  ownerName: string | null;
  starred: boolean;
  shared: boolean;
  widgets: Widget[];
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* System dashboards                                                          */
/* -------------------------------------------------------------------------- */

const w = (
  key: string,
  type: WidgetType,
  title: string,
  metric: AnalyticsMetric,
  groupBy: AnalyticsGroupBy,
  range: WidgetRange,
  metrics?: AnalyticsMetric[],
): Widget => ({ id: key, type, title, metric, groupBy, range, ...(metrics ? { metrics } : {}) });

export const SYSTEM_DASHBOARDS: Array<{ name: string; widgets: Widget[] }> = [
  {
    name: "Data enrichment & quality",
    widgets: [
      w("verified", "kpi", "Emails verified as valid", "verified_emails", "none", "30d"),
      w("jobs", "kpi", "Enrichment jobs", "enrichment_jobs", "none", "30d"),
      w("rows", "kpi", "Rows enriched", "enrichment_rows", "none", "30d"),
      w("added", "kpi", "People added", "contacts_created", "none", "30d"),
      w("rows-week", "bar", "Rows enriched per week", "enrichment_rows", "week", "90d"),
      w("verified-day", "line", "Emails verified per day", "verified_emails", "day", "30d"),
    ],
  },
  {
    name: "Engagement performance",
    widgets: [
      w("sent", "kpi", "Emails sent", "emails_sent", "none", "30d"),
      w("delivered", "kpi", "Delivered", "emails_delivered", "none", "30d"),
      w("bounced", "kpi", "Bounced", "emails_bounced", "none", "30d"),
      w("replied", "kpi", "Replies", "emails_replied", "none", "30d"),
      w("daily", "line", "Emails per day", "emails_sent", "day", "30d", [
        "emails_delivered",
        "emails_bounced",
        "emails_replied",
      ]),
      w("by-rep", "bar", "Emails sent by rep", "emails_sent", "rep", "30d"),
      w("calls-rep", "bar", "Calls logged by rep", "calls_logged", "rep", "30d"),
      w("tasks-rep", "table", "Tasks completed by rep", "tasks_completed", "rep", "30d"),
    ],
  },
  {
    name: "Sequence performance",
    widgets: [
      w("seq-table", "table", "Per sequence", "emails_sent", "sequence", "30d", [
        "emails_delivered",
        "emails_bounced",
        "emails_replied",
      ]),
      w("seq-sent", "bar", "Emails sent by sequence", "emails_sent", "sequence", "30d"),
      w("seq-replies", "bar", "Replies by sequence", "emails_replied", "sequence", "30d"),
      w("held", "kpi", "Emails held back", "emails_blocked", "none", "30d"),
    ],
  },
  {
    name: "Pipeline",
    widgets: [
      w("open", "kpi", "Open pipeline value", "open_pipeline_value", "none", "30d"),
      w("won", "kpi", "Won value this month", "deals_won_value", "none", "this_month"),
      w("won-count", "kpi", "Deals won", "deals_won", "none", "90d"),
      w("lost-count", "kpi", "Deals lost", "deals_lost", "none", "90d"),
      w("by-stage", "bar", "Open value by stage", "open_pipeline_value", "stage", "30d"),
      w("won-month", "bar", "Won and lost per month", "deals_won", "month", "90d", ["deals_lost"]),
      w("by-owner", "table", "Won value by owner", "deals_won_value", "rep", "90d"),
    ],
  },
  {
    name: "Sales manager command center",
    widgets: [
      w("reps", "table", "Activity by rep", "emails_sent", "rep", "30d", [
        "emails_replied",
        "calls_logged",
        "tasks_completed",
      ]),
      w("sent-week", "line", "Emails sent per week", "emails_sent", "week", "90d"),
      w("tasks", "kpi", "Tasks completed", "tasks_completed", "none", "7d"),
      w("calls", "kpi", "Calls logged", "calls_logged", "none", "7d"),
    ],
  },
];

const SYSTEM_NAMES = new Set(SYSTEM_DASHBOARDS.map((d) => d.name));

/** Create any missing system dashboards for the workspace (idempotent, serialised per workspace). */
export async function ensureSystemDashboards(organizationId: string): Promise<void> {
  const existing = await db
    .select({ name: schema.dashboard.name })
    .from(schema.dashboard)
    .where(and(eq(schema.dashboard.organizationId, organizationId), eq(schema.dashboard.kind, "system")));
  if (SYSTEM_DASHBOARDS.every((d) => existing.some((e) => e.name === d.name))) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dashboards:${organizationId}`}))`);
    const rows = await tx
      .select({ name: schema.dashboard.name })
      .from(schema.dashboard)
      .where(and(eq(schema.dashboard.organizationId, organizationId), eq(schema.dashboard.kind, "system")));
    const have = new Set(rows.map((r) => r.name));
    const missing = SYSTEM_DASHBOARDS.filter((d) => !have.has(d.name));
    if (!missing.length) return;
    await tx.insert(schema.dashboard).values(
      missing.map((d) => ({
        organizationId,
        ownerId: null,
        name: d.name,
        kind: "system" as const,
        widgets: d.widgets,
        shared: true,
      })),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

function parseWidgets(raw: unknown[]): Widget[] {
  const out: Widget[] = [];
  for (const item of raw) {
    const parsed = widgetSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function toDto(row: DashboardRow, ownerName: string | null): DashboardDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ownerId: row.ownerId,
    ownerName,
    starred: row.starred,
    shared: row.shared,
    widgets: parseWidgets(row.widgets),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function visible(actor: Actor): SQL {
  const own = actor.userId ? eq(schema.dashboard.ownerId, actor.userId) : sql`false`;
  return and(
    eq(schema.dashboard.organizationId, actor.organizationId),
    or(eq(schema.dashboard.kind, "system"), eq(schema.dashboard.shared, true), own),
  ) as SQL;
}

export async function listDashboards(actor: Actor): Promise<DashboardDto[]> {
  await ensureSystemDashboards(actor.organizationId);
  const rows = await db
    .select({ d: schema.dashboard, ownerName: schema.user.name })
    .from(schema.dashboard)
    .leftJoin(schema.user, eq(schema.user.id, schema.dashboard.ownerId))
    .where(and(visible(actor), sql`${schema.dashboard.kind} <> 'home'`))
    .orderBy(desc(schema.dashboard.starred), asc(schema.dashboard.kind), desc(schema.dashboard.updatedAt));
  return rows.map((r) => toDto(r.d, r.ownerName));
}

async function findDashboard(actor: Actor, id: string): Promise<{ row: DashboardRow; ownerName: string | null }> {
  const [found] = await db
    .select({ d: schema.dashboard, ownerName: schema.user.name })
    .from(schema.dashboard)
    .leftJoin(schema.user, eq(schema.user.id, schema.dashboard.ownerId))
    .where(and(visible(actor), eq(schema.dashboard.id, id)))
    .limit(1);
  if (!found) throw notFound("Dashboard not found.");
  return { row: found.d, ownerName: found.ownerName };
}

export async function getDashboard(actor: Actor, id: string): Promise<DashboardDto> {
  const { row, ownerName } = await findDashboard(actor, id);
  return toDto(row, ownerName);
}

/* -------------------------------------------------------------------------- */
/* Widget data                                                                */
/* -------------------------------------------------------------------------- */

export interface WidgetData {
  series: Array<{ metric: AnalyticsMetric; label: string }>;
  rows: Array<{ key: string; label: string; values: Partial<Record<AnalyticsMetric, number>> }>;
  totals: Partial<Record<AnalyticsMetric, number>>;
  from: string;
  to: string;
  error: string | null;
}

export async function widgetData(actor: Actor, widget: Widget, now = new Date()): Promise<WidgetData> {
  const { from, to } = rangeDates(widget.range, now);
  const metrics = [widget.metric, ...(widget.metrics ?? [])];
  const series = metrics.map((metric) => ({ metric, label: METRIC_LABELS[metric] }));
  try {
    const results = await Promise.all(
      metrics.map((metric) => queryAnalytics(actor, { metric, groupBy: widget.groupBy, from, to })),
    );
    const rows = new Map<string, WidgetData["rows"][number]>();
    const totals: WidgetData["totals"] = {};
    for (const result of results) {
      totals[result.metric] = result.total;
      for (const r of result.rows) {
        const row = rows.get(r.key) ?? { key: r.key, label: r.label, values: {} };
        row.values[result.metric] = r.value;
        rows.set(r.key, row);
      }
    }
    const list = [...rows.values()];
    for (const row of list) for (const m of metrics) row.values[m] ??= 0;
    if (widget.groupBy !== "none" && !["day", "week", "month"].includes(widget.groupBy)) {
      list.sort((a, b) => (b.values[widget.metric] ?? 0) - (a.values[widget.metric] ?? 0));
    }
    return { series, rows: list, totals, from: from.toISOString(), to: to.toISOString(), error: null };
  } catch (error) {
    log.error("widget query failed", { component: "analytics", metric: widget.metric, error });
    return {
      series,
      rows: [],
      totals: {},
      from: from.toISOString(),
      to: to.toISOString(),
      error: "This widget couldn't load.",
    };
  }
}

export async function dashboardWithData(actor: Actor, id: string) {
  const dashboard = await getDashboard(actor, id);
  const data = await Promise.all(dashboard.widgets.map((widget) => widgetData(actor, widget)));
  return { dashboard, data: Object.fromEntries(dashboard.widgets.map((widget, i) => [widget.id, data[i]])) };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

export async function createDashboard(actor: Actor, input: z.infer<typeof createDashboardInput>) {
  requirePermission(actor, "dashboard:manage");
  if (SYSTEM_NAMES.has(input.name)) {
    throw new HttpError(422, "Some fields are invalid.", [
      { path: "name", message: "A system dashboard already uses this name." },
    ]);
  }
  const [row] = await db
    .insert(schema.dashboard)
    .values({
      organizationId: actor.organizationId,
      ownerId: actor.userId,
      name: input.name,
      kind: "custom",
      widgets: input.widgets ?? [],
      shared: input.shared ?? true,
      starred: input.starred ?? false,
    })
    .returning();
  if (!row) throw new Error("dashboard insert returned nothing");
  await audit(actor, "dashboard.create", "dashboard", row.id, { name: row.name });
  return getDashboard(actor, row.id);
}

export async function updateDashboard(actor: Actor, id: string, input: z.infer<typeof updateDashboardInput>) {
  requirePermission(actor, "dashboard:manage");
  const { row } = await findDashboard(actor, id);
  if (
    row.kind === "system" &&
    (input.name !== undefined || input.widgets !== undefined || input.shared !== undefined)
  ) {
    throw new HttpError(422, "System dashboards can't be renamed or edited. Create your own dashboard instead.", [
      { path: input.name !== undefined ? "name" : "widgets", message: "System dashboards can only be starred." },
    ]);
  }
  if (input.name && SYSTEM_NAMES.has(input.name)) {
    throw new HttpError(422, "Some fields are invalid.", [
      { path: "name", message: "A system dashboard already uses this name." },
    ]);
  }
  const patch: Partial<typeof schema.dashboard.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.widgets !== undefined) patch.widgets = input.widgets;
  if (input.shared !== undefined) patch.shared = input.shared;
  if (input.starred !== undefined) patch.starred = input.starred;
  if (Object.keys(patch).length) {
    await db
      .update(schema.dashboard)
      .set(patch)
      .where(and(eq(schema.dashboard.id, id), eq(schema.dashboard.organizationId, actor.organizationId)));
    await audit(actor, "dashboard.update", "dashboard", id, { fields: Object.keys(patch) });
  }
  return getDashboard(actor, id);
}

export async function deleteDashboard(actor: Actor, id: string) {
  requirePermission(actor, "dashboard:manage");
  const { row } = await findDashboard(actor, id);
  if (row.kind === "system") throw new HttpError(422, "System dashboards can't be deleted.");
  await db
    .delete(schema.dashboard)
    .where(and(eq(schema.dashboard.id, id), eq(schema.dashboard.organizationId, actor.organizationId)));
  await audit(actor, "dashboard.delete", "dashboard", id, { name: row.name });
  return { id, deleted: true };
}
