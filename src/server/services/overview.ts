import "server-only";

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { OPEN_DEAL_STAGES } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";

import { stageTotals, wonSince } from "./deals";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface OverviewDto {
  contacts: number;
  companies: number;
  contactsWithEmail: number;
  verifiedEmails: number;
  /** Share of contacts with an email whose address verified as valid (0–1). Null when there are none. */
  verifiedEmailRate: number | null;
  activeSequences: number;
  emailsSentLast7Days: number;
  /** Open tasks assigned to the acting user, due by the end of today (UTC), overdue included. */
  myTasksDueToday: number;
  myTasksOverdue: number;
  openTasks: number;
  pipeline: { stage: string; name: string; count: number; amount: number }[];
  openPipelineValue: number;
  openDeals: number;
  dealsWonThisMonth: { count: number; amount: number };
  generatedAt: string;
}

/** Workspace KPIs for the overview screen. Every count is scoped to the actor's workspace. */
export async function getOverview(actor: Actor): Promise<OverviewDto> {
  const org = actor.organizationId;
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const tomorrow = new Date(todayStart.getTime() + 864e5);
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const count = sql<number>`count(*)::int`;

  const [contactStats, [companies], [sequences], [sent], [tasks], totals, won] = await Promise.all([
    db
      .select({
        total: count,
        withEmail: sql<number>`count(${schema.contact.email})::int`,
        verified: sql<number>`count(*) filter (where ${schema.contact.emailStatus} = 'valid')::int`,
      })
      .from(schema.contact)
      .where(eq(schema.contact.organizationId, org)),
    db.select({ count }).from(schema.company).where(eq(schema.company.organizationId, org)),
    db
      .select({ count })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, org), eq(schema.sequence.status, "active"))),
    db
      .select({ count })
      .from(schema.outboundMessage)
      .where(
        and(
          eq(schema.outboundMessage.organizationId, org),
          eq(schema.outboundMessage.status, "sent"),
          isNotNull(schema.outboundMessage.sentAt),
          gte(schema.outboundMessage.sentAt, weekAgo),
        ),
      ),
    db
      .select({
        open: count,
        mineDue: actor.userId
          ? sql<number>`count(*) filter (where ${schema.task.assigneeId} = ${actor.userId} and ${schema.task.dueAt} < ${tomorrow})::int`
          : sql<number>`0`,
        mineOverdue: actor.userId
          ? sql<number>`count(*) filter (where ${schema.task.assigneeId} = ${actor.userId} and ${schema.task.dueAt} < ${todayStart})::int`
          : sql<number>`0`,
      })
      .from(schema.task)
      .where(and(eq(schema.task.organizationId, org), eq(schema.task.status, "open"))),
    stageTotals(actor, inArray(schema.deal.stage, [...OPEN_DEAL_STAGES])),
    wonSince(actor, monthStart),
  ]);

  const stats = contactStats[0];
  const pipeline = totals.filter((t) => (OPEN_DEAL_STAGES as readonly string[]).includes(t.stage));
  return {
    contacts: stats?.total ?? 0,
    companies: companies?.count ?? 0,
    contactsWithEmail: stats?.withEmail ?? 0,
    verifiedEmails: stats?.verified ?? 0,
    verifiedEmailRate: stats?.withEmail ? stats.verified / stats.withEmail : null,
    activeSequences: sequences?.count ?? 0,
    emailsSentLast7Days: sent?.count ?? 0,
    myTasksDueToday: Number(tasks?.mineDue ?? 0),
    myTasksOverdue: Number(tasks?.mineOverdue ?? 0),
    openTasks: tasks?.open ?? 0,
    pipeline,
    openPipelineValue: pipeline.reduce((sum, s) => sum + s.amount, 0),
    openDeals: pipeline.reduce((sum, s) => sum + s.count, 0),
    dealsWonThisMonth: won,
    generatedAt: now.toISOString(),
  };
}
