import "server-only";

import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { isEmailStep } from "@/lib/engage-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";

import { mailboxIssues } from "./mailboxes";
import { recentBounceRate, rulesetOf } from "./sending";
import { BOUNCE_GUARD_MIN_SAMPLE, sendingPolicyFor } from "./sending-guards";
import { findSequence, orderedSteps } from "./sequences";

/**
 * Read-only views over sequences: workspace analytics, diagnostics, per-sequence health, optimize
 * suggestions and the activity timeline. Everything here is computed from stored data.
 */

type StepRow = typeof schema.sequenceStep.$inferSelect;
type VariantRow = typeof schema.stepVariant.$inferSelect;

const MERGE_TOKEN = /\{\{\s*[a-zA-Z_]+\s*\}\}/;

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

export interface SequenceAnalyticsRow {
  id: string;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  bounced: number;
  replied: number;
  interested: number;
  unsubscribed: number;
  opened: number | null;
  steps: { position: number; type: string; sent: number; bounced: number; notSent: number }[];
}

export async function sequenceAnalytics(actor: Actor): Promise<SequenceAnalyticsRow[]> {
  const sequences = await db
    .select()
    .from(schema.sequence)
    .where(and(eq(schema.sequence.organizationId, actor.organizationId), ne(schema.sequence.status, "archived")))
    .orderBy(desc(schema.sequence.updatedAt))
    .limit(200);
  const ids = sequences.map((s) => s.id);
  if (!ids.length) return [];
  const o = schema.outboundMessage;
  const perStep = await db
    .select({
      sequenceId: schema.enrollment.sequenceId,
      stepId: o.stepId,
      sent: sql<number>`count(*) filter (where ${o.status} in ('sent', 'bounced'))::int`,
      bounced: sql<number>`count(*) filter (where ${o.status} = 'bounced')::int`,
      notSent: sql<number>`count(*) filter (where ${o.status} = 'blocked')::int`,
    })
    .from(o)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, o.enrollmentId))
    .where(inArray(schema.enrollment.sequenceId, ids))
    .groupBy(schema.enrollment.sequenceId, o.stepId);
  const enrollments = await db
    .select({
      sequenceId: schema.enrollment.sequenceId,
      replied: sql<number>`count(*) filter (where ${schema.enrollment.status} = 'replied')::int`,
      unsubscribed: sql<number>`count(*) filter (where ${schema.enrollment.status} = 'unsubscribed')::int`,
      interested: sql<number>`count(*) filter (where ${schema.contact.stage} = 'interested')::int`,
    })
    .from(schema.enrollment)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
    .where(inArray(schema.enrollment.sequenceId, ids))
    .groupBy(schema.enrollment.sequenceId);
  const opens = await db
    .select({
      sequenceId: sql<string>`${schema.activity.metadata}->>'sequenceId'`,
      n: sql<number>`count(distinct ${schema.activity.metadata}->>'messageId')::int`,
    })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.organizationId, actor.organizationId),
        eq(schema.activity.type, "email_opened"),
        inArray(sql`${schema.activity.metadata}->>'sequenceId'`, ids),
      ),
    )
    .groupBy(sql`${schema.activity.metadata}->>'sequenceId'`);
  const steps = await db
    .select()
    .from(schema.sequenceStep)
    .where(inArray(schema.sequenceStep.sequenceId, ids))
    .orderBy(asc(schema.sequenceStep.position));
  return sequences.map((s) => {
    const rows = perStep.filter((r) => r.sequenceId === s.id);
    const e = enrollments.find((r) => r.sequenceId === s.id);
    const sent = rows.reduce((a, r) => a + Number(r.sent), 0);
    const bounced = rows.reduce((a, r) => a + Number(r.bounced), 0);
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      sent,
      delivered: sent - bounced,
      bounced,
      replied: Number(e?.replied ?? 0),
      interested: Number(e?.interested ?? 0),
      unsubscribed: Number(e?.unsubscribed ?? 0),
      opened: s.trackOpens ? Number(opens.find((r) => r.sequenceId === s.id)?.n ?? 0) : null,
      steps: steps
        .filter((st) => st.sequenceId === s.id)
        .map((st) => {
          const r = rows.find((x) => x.stepId === st.id);
          return {
            position: st.position,
            type: st.type,
            sent: Number(r?.sent ?? 0),
            bounced: Number(r?.bounced ?? 0),
            notSent: Number(r?.notSent ?? 0),
          };
        }),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Diagnostics and health                                                     */
/* -------------------------------------------------------------------------- */

export type IssueSeverity = "critical" | "warning" | "info";

export interface Issue {
  code: string;
  severity: IssueSeverity;
  message: string;
}

async function stepIssues(steps: StepRow[], variants: VariantRow[]): Promise<Issue[]> {
  const issues: Issue[] = [];
  const disabled = steps.filter((s) => !s.enabled);
  if (disabled.length) {
    issues.push({
      code: "steps_disabled",
      severity: "info",
      message: `${disabled.length} step${disabled.length === 1 ? " is" : "s are"} turned off and will be skipped.`,
    });
  }
  const unpersonalised = steps.filter((s) => {
    if (s.type !== "auto_email" || !s.enabled) return false;
    const versions = variants.filter((v) => v.stepId === s.id && v.active);
    const texts = versions.length
      ? versions.map((v) => `${v.subject ?? ""} ${v.body ?? ""}`)
      : [`${s.subject ?? ""} ${s.body ?? ""}`];
    return texts.some((t) => !MERGE_TOKEN.test(t));
  });
  if (unpersonalised.length) {
    issues.push({
      code: "no_personalisation",
      severity: "warning",
      message: `Step ${unpersonalised.map((s) => s.position).join(", ")} ${unpersonalised.length === 1 ? "has" : "have"} no merge fields. Personal emails get more replies.`,
    });
  }
  return issues;
}

async function missingMergeFieldBlocks(sequenceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.outboundMessage)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(
      and(
        eq(schema.enrollment.sequenceId, sequenceId),
        eq(schema.outboundMessage.status, "blocked"),
        sql`${schema.outboundMessage.blockedReason} like 'Missing merge field%'`,
      ),
    );
  return row?.n ?? 0;
}

export interface SequenceHealth {
  bounce: {
    sample: number;
    bounced: number;
    rate: number;
    threshold: number;
    guardOn: boolean;
    overThreshold: boolean;
  };
  unsubscribes: { enrolled: number; unsubscribed: number; rate: number | null };
  mailbox: { email: string | null; issues: string[]; hasSignature: boolean };
  issues: Issue[];
}

export async function sequenceHealth(actor: Actor, id: string): Promise<SequenceHealth> {
  const row = await findSequence(actor, id);
  const policy = await sendingPolicyFor(actor.organizationId);
  const ruleset = rulesetOf(row);
  const steps = await orderedSteps(row.id);
  const variants = steps.length
    ? await db
        .select()
        .from(schema.stepVariant)
        .where(
          inArray(
            schema.stepVariant.stepId,
            steps.map((s) => s.id),
          ),
        )
    : [];
  const [mailbox] = row.mailboxId
    ? await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, row.mailboxId)).limit(1)
    : [];
  const rate = await recentBounceRate(row.id);
  const [enr] = await db
    .select({
      enrolled: sql<number>`count(*) filter (where ${schema.enrollment.status} <> 'removed')::int`,
      unsubscribed: sql<number>`count(*) filter (where ${schema.enrollment.status} = 'unsubscribed')::int`,
    })
    .from(schema.enrollment)
    .where(eq(schema.enrollment.sequenceId, row.id));
  const enrolled = Number(enr?.enrolled ?? 0);
  const unsubscribed = Number(enr?.unsubscribed ?? 0);
  const overThreshold = rate.sample >= BOUNCE_GUARD_MIN_SAMPLE && rate.rate > policy.bounceThreshold;

  const issues: Issue[] = [];
  if (!mailbox) issues.push({ code: "no_mailbox", severity: "critical", message: "Pick a mailbox to send from." });
  else {
    for (const message of mailboxIssues(mailbox)) issues.push({ code: "mailbox", severity: "critical", message });
    if (policy.requireSignature && !mailbox.signature?.trim()) {
      issues.push({
        code: "missing_signature",
        severity: "critical",
        message: "Sending protection requires a signature, and this mailbox has none.",
      });
    }
  }
  if (overThreshold) {
    issues.push({
      code: "high_bounce",
      severity: "critical",
      message: `${rate.bounced} of the last ${rate.sample} emails bounced (over the ${Math.round(policy.bounceThreshold * 100)}% threshold).`,
    });
  }
  if (ruleset.ignoreBounceProtection) {
    issues.push({
      code: "bounce_guard_off",
      severity: "warning",
      message: "Bounce protection is turned off for this sequence.",
    });
  }
  if (enrolled >= 20 && unsubscribed / enrolled > 0.02) {
    issues.push({
      code: "high_unsubscribe",
      severity: "warning",
      message: `${unsubscribed} of ${enrolled} contacts unsubscribed. Review the targeting and copy.`,
    });
  }
  issues.push(...(await stepIssues(steps, variants)));
  const missing = await missingMergeFieldBlocks(row.id);
  if (missing) {
    issues.push({
      code: "missing_merge_fields",
      severity: "warning",
      message: `${missing} email${missing === 1 ? " was" : "s were"} held back because a contact is missing a merge field.`,
    });
  }
  return {
    bounce: {
      ...rate,
      threshold: policy.bounceThreshold,
      guardOn: policy.bounceGuard && !ruleset.ignoreBounceProtection,
      overThreshold,
    },
    unsubscribes: { enrolled, unsubscribed, rate: enrolled ? unsubscribed / enrolled : null },
    mailbox: {
      email: mailbox?.email ?? null,
      issues: mailbox ? mailboxIssues(mailbox) : [],
      hasSignature: Boolean(mailbox?.signature?.trim()),
    },
    issues,
  };
}

export interface DiagnosticsRow {
  id: string;
  name: string;
  status: string;
  issues: Issue[];
}

/** Sequences with problems, worst first. */
export async function sequenceDiagnostics(actor: Actor): Promise<DiagnosticsRow[]> {
  const rows = await db
    .select({
      id: schema.sequence.id,
      name: schema.sequence.name,
      status: schema.sequence.status,
      ruleset: schema.sequence.ruleset,
    })
    .from(schema.sequence)
    .where(and(eq(schema.sequence.organizationId, actor.organizationId), ne(schema.sequence.status, "archived")))
    .orderBy(desc(schema.sequence.updatedAt))
    .limit(100);
  const out: DiagnosticsRow[] = [];
  for (const r of rows) {
    const health = await sequenceHealth(actor, r.id);
    const issues = [...health.issues];
    const pausedAt = (r.ruleset as Record<string, unknown>).bounceGuardPausedAt;
    if (r.status === "paused" && typeof pausedAt === "string") {
      issues.unshift({
        code: "paused_by_bounce_guard",
        severity: "critical",
        message: "Bounce guard paused this sequence.",
      });
    }
    if (issues.length) out.push({ id: r.id, name: r.name, status: r.status, issues });
  }
  const rank = (i: Issue[]) => {
    if (i.some((x) => x.severity === "critical")) return 0;
    if (i.some((x) => x.severity === "warning")) return 1;
    return 2;
  };
  return out.sort((a, b) => rank(a.issues) - rank(b.issues));
}

/* -------------------------------------------------------------------------- */
/* Optimize                                                                   */
/* -------------------------------------------------------------------------- */

export interface Suggestion {
  code: string;
  stepPosition: number | null;
  title: string;
  detail: string;
}

/** Deterministic suggestions from the steps' content and spacing. */
export async function optimizeSequence(actor: Actor, id: string): Promise<Suggestion[]> {
  const row = await findSequence(actor, id);
  const steps = await orderedSteps(row.id);
  const variants = steps.length
    ? await db
        .select()
        .from(schema.stepVariant)
        .where(
          inArray(
            schema.stepVariant.stepId,
            steps.map((s) => s.id),
          ),
        )
    : [];
  const out: Suggestion[] = [];
  if (!steps.length) {
    return [
      {
        code: "empty",
        stepPosition: null,
        title: "Add your first step",
        detail: "Start with an automatic email, then add follow-ups a few days apart.",
      },
    ];
  }
  let lastEmailAt: number | null = null;
  let elapsed = 0;
  for (const s of steps) {
    elapsed += s.waitDays * 24 * 60 + s.waitMinutes;
    if (!s.enabled || !isEmailStep(s.type)) continue;
    const versions = variants.filter((v) => v.stepId === s.id && v.active);
    const contents = versions.length
      ? versions.map((v) => ({ subject: v.subject ?? "", body: v.body ?? "" }))
      : [{ subject: s.subject ?? "", body: s.body ?? "" }];
    for (const c of contents) {
      if (s.threadMode !== "reply" && c.subject.length > 60) {
        out.push({
          code: "subject_length",
          stepPosition: s.position,
          title: "Shorten the subject",
          detail: `Subjects under about 60 characters read fully on phones. This one has ${c.subject.length}.`,
        });
      }
      if (!MERGE_TOKEN.test(`${c.subject} ${c.body}`)) {
        out.push({
          code: "personalisation",
          stepPosition: s.position,
          title: "Personalise the email",
          detail: "Add merge fields such as {{first_name}} or {{company}} so it reads as written for them.",
        });
      }
      const words = c.body.trim().split(/\s+/).filter(Boolean).length;
      if (words > 200) {
        out.push({
          code: "body_length",
          stepPosition: s.position,
          title: "Cut the email down",
          detail: `Short emails (under about 125 words) get more replies. This one has ${words}.`,
        });
      }
      const links = (c.body.match(/https?:\/\//g) ?? []).length;
      if (links > 2) {
        out.push({
          code: "links",
          stepPosition: s.position,
          title: "Use fewer links",
          detail: `${links} links can look promotional to spam filters. Keep one at most.`,
        });
      }
    }
    if (lastEmailAt !== null && elapsed - lastEmailAt < 2 * 24 * 60) {
      out.push({
        code: "spacing",
        stepPosition: s.position,
        title: "Space out the follow-up",
        detail: "Leave at least two days between emails so follow-ups don't feel pushy.",
      });
    }
    lastEmailAt = elapsed;
  }
  if (!steps.some((s) => s.type === "call")) {
    out.push({
      code: "call_step",
      stepPosition: null,
      title: "Add a phone call step",
      detail: "Mixing a call into the sequence usually lifts the reply rate. It creates a call task when due.",
    });
  }
  if (steps.filter((s) => isEmailStep(s.type)).length === 1) {
    out.push({
      code: "follow_up",
      stepPosition: null,
      title: "Add a follow-up email",
      detail: "Most replies come after the first email. Add one or two follow-ups in the same thread.",
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                   */
/* -------------------------------------------------------------------------- */

export interface SequenceActivityItem {
  id: string;
  type: string;
  summary: string;
  occurredAt: string;
  contact: { id: string; name: string } | null;
}

/** Sends, opens, clicks, replies, tasks and other events for this sequence, newest first. */
export async function sequenceActivity(actor: Actor, id: string, limit = 100): Promise<SequenceActivityItem[]> {
  const row = await findSequence(actor, id);
  const rows = await db
    .select({
      id: schema.activity.id,
      type: schema.activity.type,
      summary: schema.activity.summary,
      occurredAt: schema.activity.occurredAt,
      contactId: schema.activity.contactId,
      firstName: schema.contact.firstName,
      lastName: schema.contact.lastName,
      email: schema.contact.email,
    })
    .from(schema.activity)
    .leftJoin(schema.contact, eq(schema.contact.id, schema.activity.contactId))
    .where(
      and(
        eq(schema.activity.organizationId, actor.organizationId),
        sql`${schema.activity.metadata}->>'sequenceId' = ${row.id}`,
      ),
    )
    .orderBy(desc(schema.activity.occurredAt))
    .limit(Math.min(500, Math.max(1, limit)));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    summary: r.summary,
    occurredAt: r.occurredAt.toISOString(),
    contact: r.contactId
      ? { id: r.contactId, name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Contact" }
      : null,
  }));
}
