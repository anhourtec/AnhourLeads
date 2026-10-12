import "server-only";

import { and, arrayOverlaps, asc, count, desc, eq, ilike, inArray, isNotNull, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import {
  ACCOUNT_STAGE_OPTIONS,
  CONTACT_STAGE_OPTIONS,
  DEFAULT_RULESET,
  type Ruleset,
  SAME_ACCOUNT_REPLY_ACTIONS,
  STEP_TYPES,
  THREAD_MODES,
} from "@/lib/engage-constants";
import { ROLE_RANK } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import { assertAntiSpamAccepted } from "./consents";
import { emitEvent as recordEvent } from "./engage-events";
import { searchContacts } from "./lists";
import { findMailbox, mailboxIssues } from "./mailboxes";
import { findSchedule } from "./schedules";
import { nextEnabledIndex, rulesetOf, stepDelayMs, suppressionsFor } from "./sending";

export { STEP_TYPES };

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

export const REVIEW_MODES = ["all", "first_step", "none"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optionalBody = z
  .string()
  .max(20_000)
  .nullish()
  .transform((v) => (v?.trim() ? v : null));

export const variantSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    label: z.string().trim().min(1).max(20),
    subject: optionalText(300),
    body: optionalBody,
    active: z.boolean().default(true),
  })
  .strict();

export const stepSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    type: z.enum(STEP_TYPES),
    waitDays: z.number().int().min(0, "Wait 0 days or more.").max(365, "Wait at most 365 days.").default(0),
    waitMinutes: z
      .number()
      .int()
      .min(0, "Wait 0 minutes or more.")
      .max(1439, "Use days for waits of a day or more.")
      .default(0),
    enabled: z.boolean().default(true),
    threadMode: z.enum(THREAD_MODES).default("new_thread"),
    subject: optionalText(300),
    body: optionalBody,
    /** A/B tests. When given, the first one is "A" and its content is also stored on the step. */
    variants: z.array(variantSchema).max(5, "At most 5 versions per step.").optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (step.type !== "auto_email") return;
    const needsSubject = step.threadMode !== "reply";
    if (step.variants?.length) {
      if (!step.variants.some((v) => v.active)) {
        ctx.addIssue({ code: "custom", path: ["variants"], message: "Keep at least one version active." });
      }
      const labels = new Set<string>();
      step.variants.forEach((v, i) => {
        if (labels.has(v.label.toUpperCase())) {
          ctx.addIssue({
            code: "custom",
            path: ["variants", i, "label"],
            message: "Each version needs its own label.",
          });
        }
        labels.add(v.label.toUpperCase());
        if (!v.active) return;
        if (needsSubject && !v.subject) {
          ctx.addIssue({
            code: "custom",
            path: ["variants", i, "subject"],
            message: "Automatic emails need a subject.",
          });
        }
        if (!v.body)
          ctx.addIssue({ code: "custom", path: ["variants", i, "body"], message: "Automatic emails need a body." });
      });
      return;
    }
    if (needsSubject && !step.subject) {
      ctx.addIssue({ code: "custom", path: ["subject"], message: "Automatic emails need a subject." });
    }
    if (!step.body) ctx.addIssue({ code: "custom", path: ["body"], message: "Automatic emails need a body." });
  });

export type StepInput = z.infer<typeof stepSchema>;

const emailList = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => v || null)
  .refine(
    (v) =>
      !v ||
      v
        .split(/[,;\s]+/)
        .filter(Boolean)
        .every((e) => z.email().safeParse(e).success),
    "Use email addresses separated by commas.",
  );

const contactStages = CONTACT_STAGE_OPTIONS.map(([v]) => v) as [string, ...string[]];
const accountStages = ACCOUNT_STAGE_OPTIONS.map(([v]) => v) as [string, ...string[]];

export const rulesetSchema = z
  .object({
    sameAccountReply: z.enum(SAME_ACCOUNT_REPLY_ACTIONS),
    openCallTask: z.object({ enabled: z.boolean(), opens: z.number().int().min(1).max(50) }).strict(),
    finishOnClick: z.boolean(),
    unresponsiveAfterDays: z.number().int().min(1).max(365).nullable(),
    notSentContactStages: z.array(z.enum(contactStages)).max(contactStages.length),
    notSentAccountStages: z.array(z.enum(accountStages)).max(accountStages.length),
    ignoreBounceProtection: z.boolean(),
  })
  .partial()
  .strict();

const tags = z.array(z.string().trim().min(1).max(40)).max(20, "At most 20 tags.");

const settings = {
  name: z.string().trim().min(1, "Name the sequence.").max(120),
  description: optionalText(2000),
  tags,
  ownerId: z.string().min(1).max(100).nullish(),
  starred: z.boolean(),
  scheduleId: z.string().min(1).max(100).nullish(),
  mailboxId: z.string().min(1).max(100).nullish(),
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  stopOnReply: z.boolean(),
  reviewMode: z.enum(REVIEW_MODES),
  cc: emailList,
  bcc: emailList,
  maxPer24h: z.number().int().min(1, "At least 1.").max(5000).nullish(),
  ruleset: rulesetSchema,
};

export const createSequenceSchema = z
  .object({
    name: settings.name,
    description: settings.description,
    tags: settings.tags.default([]),
    ownerId: settings.ownerId,
    starred: settings.starred.default(false),
    scheduleId: settings.scheduleId,
    mailboxId: settings.mailboxId,
    trackOpens: settings.trackOpens.default(false),
    trackClicks: settings.trackClicks.default(false),
    stopOnReply: settings.stopOnReply.default(true),
    reviewMode: settings.reviewMode.default("all"),
    cc: settings.cc,
    bcc: settings.bcc,
    maxPer24h: settings.maxPer24h,
    ruleset: settings.ruleset.optional(),
    steps: z.array(stepSchema).max(30, "At most 30 steps.").default([]),
  })
  .strict();

export const updateSequenceSchema = z.object(settings).partial().strict();

export const replaceStepsSchema = z.object({ steps: z.array(stepSchema).max(30, "At most 30 steps.") }).strict();

function parseBool(v: unknown): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}
const boolParam = z.preprocess(parseBool, z.boolean());

export const searchSequencesSchema = z.object({
  q: z.string().trim().max(200).optional(),
  qName: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  ownerId: z.string().min(1).max(100).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  starred: boolParam.optional(),
  sort: z.enum(["updated", "created", "name"]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
  per_page: z.union([z.number(), z.string()]).optional(),
});

const idList = z.array(z.string().min(1).max(100)).min(1, "Pass at least one contact id.").max(1000);

export const addContactsSchema = z.object({ contactIds: idList }).strict();
export const markRepliedSchema = z
  .object({
    contactIds: idList,
    /** Optional details of the reply, used to tell out-of-office auto-replies apart. */
    subject: z.string().max(500).optional(),
    headers: z.record(z.string().max(100), z.string().max(1000)).optional(),
  })
  .strict();
export const removeOrStopSchema = z
  .object({
    sequenceIds: z.array(z.string().min(1).max(100)).min(1, "Pass at least one sequence id.").max(100),
    contactIds: idList,
    mode: z.enum(["remove", "stop", "finish"]),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

type SequenceRow = typeof schema.sequence.$inferSelect;
type StepRow = typeof schema.sequenceStep.$inferSelect;
type VariantRow = typeof schema.stepVariant.$inferSelect;

export interface SequenceStats {
  enrolled: number;
  active: number;
  paused: number;
  finished: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  sent: number;
  pendingReview: number;
  blocked: number;
  failed: number;
  opened: number;
  clicked: number;
  /** Fractions (0–1) of sent emails; null when nothing was sent or tracking is off. */
  openRate: number | null;
  replyRate: number | null;
}

export interface VariantView {
  id: string;
  label: string;
  subject: string | null;
  body: string | null;
  active: boolean;
}

export interface StepView {
  id: string;
  position: number;
  type: StepRow["type"];
  waitDays: number;
  waitMinutes: number;
  enabled: boolean;
  threadMode: StepRow["threadMode"];
  subject: string | null;
  body: string | null;
  variants: VariantView[];
}

export interface SequenceView {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  status: SequenceRow["status"];
  starred: boolean;
  owner: { id: string; name: string; email: string } | null;
  ownerId: string | null;
  scheduleId: string | null;
  schedule: { id: string; name: string } | null;
  mailboxId: string | null;
  mailbox: {
    id: string;
    email: string;
    displayName: string | null;
    readyToSend: boolean;
    issues: string[];
    hasSignature: boolean;
  } | null;
  trackOpens: boolean;
  trackClicks: boolean;
  stopOnReply: boolean;
  reviewMode: SequenceRow["reviewMode"];
  cc: string | null;
  bcc: string | null;
  maxPer24h: number | null;
  ruleset: Ruleset;
  /** When bounce guard last paused the sequence (cleared on activation). */
  bounceGuardPausedAt: string | null;
  stepCount: number;
  stats: SequenceStats;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

const emptyStats = (): SequenceStats => ({
  enrolled: 0,
  active: 0,
  paused: 0,
  finished: 0,
  replied: 0,
  bounced: 0,
  unsubscribed: 0,
  sent: 0,
  pendingReview: 0,
  blocked: 0,
  failed: 0,
  opened: 0,
  clicked: 0,
  openRate: null,
  replyRate: null,
});

type CountKey = "enrolled" | "active" | "paused" | "finished" | "replied" | "bounced" | "unsubscribed";

async function statsFor(rows: SequenceRow[]): Promise<Map<string, SequenceStats>> {
  const ids = rows.map((r) => r.id);
  const map = new Map(ids.map((id) => [id, emptyStats()]));
  if (!ids.length) return map;
  const enrollments = await db
    .select({ sequenceId: schema.enrollment.sequenceId, status: schema.enrollment.status, n: count() })
    .from(schema.enrollment)
    .where(inArray(schema.enrollment.sequenceId, ids))
    .groupBy(schema.enrollment.sequenceId, schema.enrollment.status);
  for (const r of enrollments) {
    const s = map.get(r.sequenceId);
    if (!s) continue;
    if (r.status !== "removed") s.enrolled += r.n;
    if (r.status in s && r.status !== "removed") s[r.status as CountKey] += r.n;
  }
  const messages = await db
    .select({ sequenceId: schema.enrollment.sequenceId, status: schema.outboundMessage.status, n: count() })
    .from(schema.outboundMessage)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(inArray(schema.enrollment.sequenceId, ids))
    .groupBy(schema.enrollment.sequenceId, schema.outboundMessage.status);
  for (const r of messages) {
    const s = map.get(r.sequenceId);
    if (!s) continue;
    if (r.status === "sent") s.sent += r.n;
    if (r.status === "pending_review") s.pendingReview += r.n;
    if (r.status === "blocked") s.blocked += r.n;
    if (r.status === "failed") s.failed += r.n;
  }
  const tracked = await db
    .select({
      sequenceId: sql<string>`${schema.activity.metadata}->>'sequenceId'`,
      type: schema.activity.type,
      n: sql<number>`count(distinct ${schema.activity.metadata}->>'messageId')::int`,
    })
    .from(schema.activity)
    .where(
      and(
        inArray(schema.activity.type, ["email_opened", "email_clicked"]),
        inArray(sql`${schema.activity.metadata}->>'sequenceId'`, ids),
      ),
    )
    .groupBy(sql`${schema.activity.metadata}->>'sequenceId'`, schema.activity.type);
  for (const r of tracked) {
    const s = map.get(r.sequenceId);
    if (!s) continue;
    if (r.type === "email_opened") s.opened = Number(r.n);
    else s.clicked = Number(r.n);
  }
  for (const row of rows) {
    const s = map.get(row.id);
    if (!s?.sent) continue;
    s.replyRate = Math.min(1, s.replied / Math.max(1, s.enrolled));
    s.openRate = row.trackOpens ? Math.min(1, s.opened / s.sent) : null;
  }
  return map;
}

async function stepCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ sequenceId: schema.sequenceStep.sequenceId, n: count() })
    .from(schema.sequenceStep)
    .where(inArray(schema.sequenceStep.sequenceId, ids))
    .groupBy(schema.sequenceStep.sequenceId);
  return new Map(rows.map((r) => [r.sequenceId, r.n]));
}

async function toViews(organizationId: string, rows: SequenceRow[]): Promise<SequenceView[]> {
  const ids = rows.map((r) => r.id);
  const mailboxIds = [...new Set(rows.map((r) => r.mailboxId).filter((v): v is string => Boolean(v)))];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => Boolean(v)))];
  const scheduleIds = [...new Set(rows.map((r) => r.scheduleId).filter((v): v is string => Boolean(v)))];
  const [stats, steps, mailboxes, owners, schedules] = await Promise.all([
    statsFor(rows),
    stepCounts(ids),
    mailboxIds.length
      ? db
          .select()
          .from(schema.mailbox)
          .where(and(eq(schema.mailbox.organizationId, organizationId), inArray(schema.mailbox.id, mailboxIds)))
      : Promise.resolve([]),
    ownerIds.length
      ? db
          .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
          .from(schema.user)
          .where(inArray(schema.user.id, ownerIds))
      : Promise.resolve([]),
    scheduleIds.length
      ? db
          .select({ id: schema.sendingSchedule.id, name: schema.sendingSchedule.name })
          .from(schema.sendingSchedule)
          .where(
            and(
              eq(schema.sendingSchedule.organizationId, organizationId),
              inArray(schema.sendingSchedule.id, scheduleIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const mailboxById = new Map(mailboxes.map((m) => [m.id, m]));
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  return rows.map((r) => {
    const m = r.mailboxId ? mailboxById.get(r.mailboxId) : undefined;
    const issues = m ? mailboxIssues(m) : [];
    const raw = (r.ruleset ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      tags: r.tags,
      status: r.status,
      starred: r.starred,
      ownerId: r.ownerId,
      owner: r.ownerId ? (ownerById.get(r.ownerId) ?? null) : null,
      scheduleId: r.scheduleId,
      schedule: r.scheduleId ? (scheduleById.get(r.scheduleId) ?? null) : null,
      mailboxId: r.mailboxId,
      mailbox: m
        ? {
            id: m.id,
            email: m.email,
            displayName: m.displayName,
            readyToSend: issues.length === 0,
            issues,
            hasSignature: Boolean(m.signature?.trim()),
          }
        : null,
      trackOpens: r.trackOpens,
      trackClicks: r.trackClicks,
      stopOnReply: r.stopOnReply,
      reviewMode: r.reviewMode,
      cc: r.cc,
      bcc: r.bcc,
      maxPer24h: r.maxPer24h,
      ruleset: rulesetOf(r),
      bounceGuardPausedAt: typeof raw.bounceGuardPausedAt === "string" ? raw.bounceGuardPausedAt : null,
      stepCount: steps.get(r.id) ?? 0,
      stats: stats.get(r.id) ?? emptyStats(),
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

function variantView(v: VariantRow): VariantView {
  return { id: v.id, label: v.label, subject: v.subject, body: v.body, active: v.active };
}

function stepView(s: StepRow, variants: VariantRow[]): StepView {
  return {
    id: s.id,
    position: s.position,
    type: s.type,
    waitDays: s.waitDays,
    waitMinutes: s.waitMinutes,
    enabled: s.enabled,
    threadMode: s.threadMode,
    subject: s.subject,
    body: s.body,
    variants: variants.map(variantView),
  };
}

export async function findSequence(actor: Pick<Actor, "organizationId">, id: string): Promise<SequenceRow> {
  const [row] = await db
    .select()
    .from(schema.sequence)
    .where(and(eq(schema.sequence.id, id), eq(schema.sequence.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("Sequence not found.");
  return row;
}

export async function orderedSteps(sequenceId: string): Promise<StepRow[]> {
  return db
    .select()
    .from(schema.sequenceStep)
    .where(eq(schema.sequenceStep.sequenceId, sequenceId))
    .orderBy(asc(schema.sequenceStep.position), asc(schema.sequenceStep.createdAt));
}

async function variantsByStep(stepIds: string[]): Promise<Map<string, VariantRow[]>> {
  const map = new Map<string, VariantRow[]>();
  if (!stepIds.length) return map;
  const rows = await db
    .select()
    .from(schema.stepVariant)
    .where(inArray(schema.stepVariant.stepId, stepIds))
    .orderBy(asc(schema.stepVariant.label), asc(schema.stepVariant.createdAt));
  for (const r of rows) map.set(r.stepId, [...(map.get(r.stepId) ?? []), r]);
  return map;
}

async function stepViews(sequenceId: string): Promise<StepView[]> {
  const steps = await orderedSteps(sequenceId);
  const variants = await variantsByStep(steps.map((s) => s.id));
  return steps.map((s) => stepView(s, variants.get(s.id) ?? []));
}

/* -------------------------------------------------------------------------- */
/* Sequences                                                                  */
/* -------------------------------------------------------------------------- */

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function searchSequences(
  actor: Actor,
  input: unknown,
  page: Page,
): Promise<{ sequences: SequenceView[]; total: number }> {
  const data = searchSequencesSchema.parse(input ?? {});
  const where: SQL[] = [eq(schema.sequence.organizationId, actor.organizationId)];
  const q = data.q || data.qName;
  if (q) where.push(ilike(schema.sequence.name, escapeLike(q)));
  if (data.status) where.push(eq(schema.sequence.status, data.status));
  if (data.ownerId) where.push(eq(schema.sequence.ownerId, data.ownerId));
  if (data.tag) where.push(arrayOverlaps(schema.sequence.tags, [data.tag]));
  if (data.starred !== undefined) where.push(eq(schema.sequence.starred, data.starred));
  const ORDERS = {
    name: [asc(schema.sequence.name)],
    created: [desc(schema.sequence.createdAt)],
    updated: [desc(schema.sequence.starred), desc(schema.sequence.updatedAt)],
  };
  const order = ORDERS[data.sort ?? "updated"];
  const [total] = await db
    .select({ n: count() })
    .from(schema.sequence)
    .where(and(...where));
  const rows = await db
    .select()
    .from(schema.sequence)
    .where(and(...where))
    .orderBy(...order, asc(schema.sequence.id))
    .limit(page.perPage)
    .offset(page.offset);
  return { sequences: await toViews(actor.organizationId, rows), total: total?.n ?? 0 };
}

/** Distinct tags used on this workspace's sequences, for the tag filter. */
export async function sequenceTags(actor: Actor): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tag: sql<string>`unnest(${schema.sequence.tags})` })
    .from(schema.sequence)
    .where(eq(schema.sequence.organizationId, actor.organizationId));
  return rows.map((r) => r.tag).sort((a, b) => a.localeCompare(b));
}

export async function getSequence(actor: Actor, id: string): Promise<{ sequence: SequenceView; steps: StepView[] }> {
  const row = await findSequence(actor, id);
  const [view] = await toViews(actor.organizationId, [row]);
  return { sequence: view, steps: await stepViews(row.id) };
}

async function assertMailboxUsable(actor: Actor, mailboxId: string, forActive: boolean) {
  const mailbox = await findMailbox(actor, mailboxId).catch(() => {
    throw new HttpError(422, "Pick a mailbox from this workspace.", [{ path: "mailboxId", message: "Not found." }]);
  });
  if (forActive) {
    const issues = mailboxIssues(mailbox);
    if (issues.length) throw new HttpError(422, issues[0], [{ path: "mailboxId", message: issues.join(" ") }]);
  }
}

async function assertScheduleInScope(actor: Actor, scheduleId: string) {
  await findSchedule(actor, scheduleId).catch(() => {
    throw new HttpError(422, "Pick a schedule from this workspace.", [{ path: "scheduleId", message: "Not found." }]);
  });
}

async function assertOwnerInScope(actor: Actor, ownerId: string) {
  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(schema.member.userId, ownerId)))
    .limit(1);
  if (!row) {
    throw new HttpError(422, "Pick an owner from this workspace.", [{ path: "ownerId", message: "Not a member." }]);
  }
}

const canOverrideBounceGuard = (actor: Actor) => ROLE_RANK[actor.role] >= ROLE_RANK.manager;

function mergeRuleset(current: Record<string, unknown>, patch: z.infer<typeof rulesetSchema>): Record<string, unknown> {
  const base = { ...DEFAULT_RULESET, ...current };
  return {
    ...base,
    ...patch,
    openCallTask: { ...DEFAULT_RULESET.openCallTask, ...(base.openCallTask as object), ...(patch.openCallTask ?? {}) },
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Write a step's A/B versions: keep known ids, add new ones, drop the rest. */
async function syncVariants(tx: Tx, stepId: string, variants: StepInput["variants"]) {
  if (variants === undefined) return;
  const existing = await tx
    .select({ id: schema.stepVariant.id })
    .from(schema.stepVariant)
    .where(eq(schema.stepVariant.stepId, stepId));
  const known = new Set(existing.map((v) => v.id));
  const keep = variants.flatMap((v) => (v.id && known.has(v.id) ? [v.id] : []));
  const drop = existing.filter((v) => !keep.includes(v.id)).map((v) => v.id);
  if (drop.length) await tx.delete(schema.stepVariant).where(inArray(schema.stepVariant.id, drop));
  for (const v of variants) {
    const values = { label: v.label, subject: v.subject, body: v.body, active: v.active };
    if (v.id && known.has(v.id)) await tx.update(schema.stepVariant).set(values).where(eq(schema.stepVariant.id, v.id));
    else await tx.insert(schema.stepVariant).values({ ...values, stepId });
  }
}

/** Step columns for an input step. With versions, "A" (the first) is mirrored onto the step. */
function stepColumns(s: StepInput) {
  const first = s.variants?.[0];
  return {
    type: s.type,
    waitDays: s.waitDays,
    waitMinutes: s.waitMinutes,
    enabled: s.enabled,
    threadMode: s.threadMode,
    subject: first ? first.subject : s.subject,
    body: first ? first.body : s.body,
  };
}

async function insertSteps(tx: Tx, sequenceId: string, steps: StepInput[]) {
  for (const [i, s] of steps.entries()) {
    const [row] = await tx
      .insert(schema.sequenceStep)
      .values({ sequenceId, position: i + 1, ...stepColumns(s) })
      .returning({ id: schema.sequenceStep.id });
    if (s.variants?.length)
      await syncVariants(
        tx,
        row.id,
        s.variants.map((v) => ({ ...v, id: undefined })),
      );
  }
}

export async function createSequence(actor: Actor, input: unknown) {
  const data = createSequenceSchema.parse(input);
  await assertAntiSpamAccepted(actor);
  if (data.mailboxId) await assertMailboxUsable(actor, data.mailboxId, false);
  if (data.scheduleId) await assertScheduleInScope(actor, data.scheduleId);
  if (data.ownerId) await assertOwnerInScope(actor, data.ownerId);
  if (data.ruleset?.ignoreBounceProtection && !canOverrideBounceGuard(actor)) {
    throw forbidden("Only managers and above can turn off bounce protection.");
  }
  const sequenceId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.sequence)
      .values({
        organizationId: actor.organizationId,
        name: data.name,
        description: data.description,
        tags: [...new Set(data.tags)],
        ownerId: data.ownerId ?? actor.userId,
        starred: data.starred,
        scheduleId: data.scheduleId ?? null,
        mailboxId: data.mailboxId ?? null,
        trackOpens: data.trackOpens,
        trackClicks: data.trackClicks,
        stopOnReply: data.stopOnReply,
        reviewMode: data.reviewMode,
        cc: data.cc,
        bcc: data.bcc,
        maxPer24h: data.maxPer24h ?? null,
        ruleset: data.ruleset ? mergeRuleset({}, data.ruleset) : {},
        createdById: actor.userId,
      })
      .returning({ id: schema.sequence.id });
    await insertSteps(tx, row.id, data.steps);
    return row.id;
  });
  await audit(actor, "sequence.create", "sequence", sequenceId, { name: data.name, steps: data.steps.length });
  return getSequence(actor, sequenceId);
}

export async function updateSequence(actor: Actor, id: string, input: unknown) {
  const row = await findSequence(actor, id);
  const data = updateSequenceSchema.parse(input);
  const onlyStar = Object.keys(data).length === 1 && data.starred !== undefined;
  if (row.status === "archived" && !onlyStar) throw new HttpError(422, "Archived sequences can't be changed.");
  if (data.mailboxId !== undefined) {
    if (data.mailboxId) await assertMailboxUsable(actor, data.mailboxId, row.status === "active");
    else if (row.status === "active") {
      throw new HttpError(422, "Active sequences need a mailbox. Pause the sequence first.", [
        { path: "mailboxId", message: "Required while active." },
      ]);
    }
  }
  if (data.scheduleId) await assertScheduleInScope(actor, data.scheduleId);
  if (data.ownerId) await assertOwnerInScope(actor, data.ownerId);
  const current = (row.ruleset ?? {}) as Record<string, unknown>;
  if (
    data.ruleset?.ignoreBounceProtection !== undefined &&
    data.ruleset.ignoreBounceProtection !== Boolean(current.ignoreBounceProtection) &&
    !canOverrideBounceGuard(actor)
  ) {
    throw forbidden("Only managers and above can change bounce protection for a sequence.");
  }
  const { ruleset, ...rest } = data;
  const patch: Partial<typeof schema.sequence.$inferInsert> = { ...rest };
  if (data.tags) patch.tags = [...new Set(data.tags)];
  if (ruleset) patch.ruleset = mergeRuleset(current, ruleset);
  if (Object.keys(data).length) {
    await db
      .update(schema.sequence)
      .set(patch)
      .where(and(eq(schema.sequence.id, row.id), eq(schema.sequence.organizationId, actor.organizationId)));
    await audit(actor, "sequence.update", "sequence", row.id, { fields: Object.keys(data) });
  }
  return getSequence(actor, row.id);
}

export async function deleteSequence(actor: Actor, id: string): Promise<void> {
  const row = await findSequence(actor, id);
  await db
    .delete(schema.sequence)
    .where(and(eq(schema.sequence.id, row.id), eq(schema.sequence.organizationId, actor.organizationId)));
  await audit(actor, "sequence.delete", "sequence", row.id, { name: row.name });
}

/** Copy settings and steps (with versions) into a new draft. Contacts and history stay behind. */
export async function cloneSequence(actor: Actor, id: string) {
  const row = await findSequence(actor, id);
  await assertAntiSpamAccepted(actor);
  const steps = await stepViews(row.id);
  const name = `Copy of ${row.name}`.slice(0, 120);
  const newId = await db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(schema.sequence)
      .values({
        organizationId: actor.organizationId,
        name,
        description: row.description,
        tags: row.tags,
        ownerId: actor.userId ?? row.ownerId,
        scheduleId: row.scheduleId,
        mailboxId: row.mailboxId,
        trackOpens: row.trackOpens,
        trackClicks: row.trackClicks,
        stopOnReply: row.stopOnReply,
        reviewMode: row.reviewMode,
        cc: row.cc,
        bcc: row.bcc,
        maxPer24h: row.maxPer24h,
        ruleset: Object.fromEntries(Object.entries(row.ruleset ?? {}).filter(([k]) => k !== "bounceGuardPausedAt")),
        createdById: actor.userId,
      })
      .returning({ id: schema.sequence.id });
    await insertSteps(
      tx,
      copy.id,
      steps.map((s) => ({
        type: s.type,
        waitDays: s.waitDays,
        waitMinutes: s.waitMinutes,
        enabled: s.enabled,
        threadMode: s.threadMode,
        subject: s.subject,
        body: s.body,
        variants: s.variants.length
          ? s.variants.map((v) => ({ label: v.label, subject: v.subject, body: v.body, active: v.active }))
          : undefined,
      })),
    );
    return copy.id;
  });
  await audit(actor, "sequence.clone", "sequence", newId, { from: row.id });
  return getSequence(actor, newId);
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

async function editableSequence(actor: Actor, id: string): Promise<SequenceRow> {
  const row = await findSequence(actor, id);
  if (row.status === "archived") throw new HttpError(422, "Archived sequences can't be changed.");
  return row;
}

async function renumber(sequenceId: string) {
  const steps = await orderedSteps(sequenceId);
  await Promise.all(
    steps.map((s, i) =>
      s.position === i + 1
        ? null
        : db
            .update(schema.sequenceStep)
            .set({ position: i + 1 })
            .where(eq(schema.sequenceStep.id, s.id)),
    ),
  );
}

async function touchSequence(id: string) {
  await db.update(schema.sequence).set({ updatedAt: new Date() }).where(eq(schema.sequence.id, id));
}

export async function listSteps(actor: Actor, id: string): Promise<StepView[]> {
  const row = await findSequence(actor, id);
  return stepViews(row.id);
}

export async function addStep(actor: Actor, id: string, input: unknown): Promise<StepView[]> {
  const row = await editableSequence(actor, id);
  const step = stepSchema.parse(input);
  const steps = await orderedSteps(row.id);
  if (steps.length >= 30) throw new HttpError(422, "A sequence can have at most 30 steps.");
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.sequenceStep)
      .values({ sequenceId: row.id, position: steps.length + 1, ...stepColumns(step) })
      .returning({ id: schema.sequenceStep.id });
    if (step.variants?.length)
      await syncVariants(
        tx,
        created.id,
        step.variants.map((v) => ({ ...v, id: undefined })),
      );
  });
  await touchSequence(row.id);
  await audit(actor, "sequence.step.create", "sequence", row.id, { type: step.type });
  return listSteps(actor, row.id);
}

async function findStep(sequenceId: string, stepId: string): Promise<StepRow> {
  const [step] = await db
    .select()
    .from(schema.sequenceStep)
    .where(and(eq(schema.sequenceStep.id, stepId), eq(schema.sequenceStep.sequenceId, sequenceId)))
    .limit(1);
  if (!step) throw notFound("Step not found.");
  return step;
}

export async function updateStep(actor: Actor, id: string, stepId: string, input: unknown): Promise<StepView[]> {
  const row = await editableSequence(actor, id);
  const current = await findStep(row.id, stepId);
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const variants = raw.variants === undefined ? (await variantsByStep([current.id])).get(current.id) : undefined;
  const merged = stepSchema.parse({
    type: current.type,
    waitDays: current.waitDays,
    waitMinutes: current.waitMinutes,
    enabled: current.enabled,
    threadMode: current.threadMode,
    subject: current.subject,
    body: current.body,
    ...(variants?.length
      ? {
          variants: variants.map((v) => ({
            id: v.id,
            label: v.label,
            subject: v.subject,
            body: v.body,
            active: v.active,
          })),
        }
      : {}),
    ...raw,
    id: undefined,
  });
  await db.transaction(async (tx) => {
    await tx.update(schema.sequenceStep).set(stepColumns(merged)).where(eq(schema.sequenceStep.id, current.id));
    if (raw.variants !== undefined) await syncVariants(tx, current.id, merged.variants ?? []);
  });
  await touchSequence(row.id);
  await audit(actor, "sequence.step.update", "sequence", row.id, { stepId: current.id });
  return listSteps(actor, row.id);
}

export async function deleteStep(actor: Actor, id: string, stepId: string): Promise<StepView[]> {
  const row = await editableSequence(actor, id);
  const current = await findStep(row.id, stepId);
  if (row.status === "active") {
    const steps = await orderedSteps(row.id);
    if (steps.length <= 1) throw new HttpError(422, "Active sequences need at least one step. Pause it first.");
  }
  await db.delete(schema.sequenceStep).where(eq(schema.sequenceStep.id, current.id));
  await renumber(row.id);
  await touchSequence(row.id);
  await audit(actor, "sequence.step.delete", "sequence", row.id, { stepId: current.id });
  return listSteps(actor, row.id);
}

/**
 * Replace the ordered step list. Steps with an `id` are updated in place (so sent-message history
 * keeps pointing at them), steps without one are created, and existing steps left out are removed.
 */
export async function replaceSteps(actor: Actor, id: string, input: unknown): Promise<StepView[]> {
  const row = await editableSequence(actor, id);
  const { steps } = replaceStepsSchema.parse(input);
  if (row.status === "active" && steps.length === 0) {
    throw new HttpError(422, "Active sequences need at least one step. Pause it first.");
  }
  const existing = await orderedSteps(row.id);
  const existingIds = new Set(existing.map((s) => s.id));
  const unknown = steps.filter((s) => s.id && !existingIds.has(s.id));
  if (unknown.length) {
    throw new HttpError(422, "Some steps don't belong to this sequence.", [
      { path: "steps", message: "Unknown step id." },
    ]);
  }
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.id && seen.has(s.id)) throw new HttpError(422, "A step appears twice.", [{ path: "steps", message: s.id }]);
    if (s.id) seen.add(s.id);
  }
  await db.transaction(async (tx) => {
    const keep = steps.flatMap((s) => (s.id ? [s.id] : []));
    const remove = existing.filter((s) => !keep.includes(s.id)).map((s) => s.id);
    if (remove.length) await tx.delete(schema.sequenceStep).where(inArray(schema.sequenceStep.id, remove));
    for (const [i, s] of steps.entries()) {
      const values = { position: i + 1, ...stepColumns(s) };
      if (s.id) {
        await tx.update(schema.sequenceStep).set(values).where(eq(schema.sequenceStep.id, s.id));
        if (s.variants !== undefined) await syncVariants(tx, s.id, s.variants);
      } else {
        const [created] = await tx
          .insert(schema.sequenceStep)
          .values({ ...values, sequenceId: row.id })
          .returning({ id: schema.sequenceStep.id });
        if (s.variants?.length)
          await syncVariants(
            tx,
            created.id,
            s.variants.map((v) => ({ ...v, id: undefined })),
          );
      }
    }
    await tx.update(schema.sequence).set({ updatedAt: new Date() }).where(eq(schema.sequence.id, row.id));
  });
  await audit(actor, "sequence.steps.replace", "sequence", row.id, { steps: steps.length });
  return listSteps(actor, row.id);
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

export async function activateSequence(actor: Actor, id: string) {
  const row = await findSequence(actor, id);
  if (row.status === "archived") throw new HttpError(422, "Archived sequences can't be activated.");
  const steps = await orderedSteps(row.id);
  const problems: { path: string; message: string }[] = [];
  if (steps.length === 0) problems.push({ path: "steps", message: "Add at least one step." });
  else if (!steps.some((s) => s.enabled)) problems.push({ path: "steps", message: "Turn on at least one step." });
  if (!row.mailboxId) problems.push({ path: "mailboxId", message: "Pick a mailbox to send from." });
  else {
    const mailbox = await findMailbox(actor, row.mailboxId);
    for (const issue of mailboxIssues(mailbox)) problems.push({ path: "mailboxId", message: issue });
  }
  if (problems.length) throw new HttpError(422, problems[0].message, problems);
  if (row.status !== "active") {
    const ruleset = Object.fromEntries(Object.entries(row.ruleset ?? {}).filter(([k]) => k !== "bounceGuardPausedAt"));
    await db.update(schema.sequence).set({ status: "active", ruleset }).where(eq(schema.sequence.id, row.id));
    await audit(actor, "sequence.activate", "sequence", row.id);
  }
  return getSequence(actor, row.id);
}

export async function pauseSequence(actor: Actor, id: string) {
  const row = await findSequence(actor, id);
  if (row.status === "archived") throw new HttpError(422, "Archived sequences can't be paused.");
  if (row.status === "active") {
    await db.update(schema.sequence).set({ status: "paused" }).where(eq(schema.sequence.id, row.id));
    await audit(actor, "sequence.pause", "sequence", row.id);
  }
  return getSequence(actor, row.id);
}

/** Archive: stop sending and finish every enrollment still in progress. */
export async function archiveSequence(actor: Actor, id: string) {
  const row = await findSequence(actor, id);
  if (row.status !== "archived") {
    await db.transaction(async (tx) => {
      await tx.update(schema.sequence).set({ status: "archived" }).where(eq(schema.sequence.id, row.id));
      await tx
        .update(schema.enrollment)
        .set({ status: "finished", nextRunAt: null })
        .where(and(eq(schema.enrollment.sequenceId, row.id), inArray(schema.enrollment.status, ["active", "paused"])));
      await holdMessages(tx, { sequenceId: row.id }, "The sequence was archived.");
    });
    await audit(actor, "sequence.archive", "sequence", row.id);
  }
  return getSequence(actor, row.id);
}

/** Block unsent (review or queued) messages for these enrollments so they never go out. */
async function holdMessages(
  tx: Tx | typeof db,
  scope: { sequenceId: string; contactIds?: string[] },
  reason: string,
): Promise<void> {
  const enrollmentIds = tx
    .select({ id: schema.enrollment.id })
    .from(schema.enrollment)
    .where(
      and(
        eq(schema.enrollment.sequenceId, scope.sequenceId),
        ...(scope.contactIds ? [inArray(schema.enrollment.contactId, scope.contactIds)] : []),
      ),
    );
  await tx
    .update(schema.outboundMessage)
    .set({ status: "blocked", blockedReason: reason })
    .where(
      and(
        inArray(schema.outboundMessage.enrollmentId, enrollmentIds),
        inArray(schema.outboundMessage.status, ["pending_review", "queued", "failed"]),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Enrollment                                                                 */
/* -------------------------------------------------------------------------- */

export type SkipReason =
  | "not_found"
  | "missing_email"
  | "suppressed_email"
  | "suppressed_domain"
  | "invalid_email"
  | "disposable_email"
  | "do_not_contact"
  | "already_enrolled";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  not_found: "Not found in this workspace",
  missing_email: "No email address",
  suppressed_email: "Email is on the do-not-contact list",
  suppressed_domain: "Domain is on the do-not-contact list",
  invalid_email: "Email is invalid",
  disposable_email: "Email is disposable",
  do_not_contact: "Stage is do not contact",
  already_enrolled: "Already in this sequence",
};

export interface EnrollResult {
  enrolled: string[];
  skipped: { contactId: string; reason: SkipReason; message: string }[];
}

export async function enrollContacts(actor: Actor, id: string, input: unknown): Promise<EnrollResult> {
  const row = await findSequence(actor, id);
  const { contactIds } = addContactsSchema.parse(input);
  if (row.status === "archived") throw new HttpError(422, "Archived sequences can't take new contacts.");
  const unique = [...new Set(contactIds)];
  const contacts = await db
    .select({
      id: schema.contact.id,
      email: schema.contact.email,
      emailStatus: schema.contact.emailStatus,
      stage: schema.contact.stage,
      companyId: schema.contact.companyId,
    })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), inArray(schema.contact.id, unique)));
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const enrolledAlready = new Set(
    (
      await db
        .select({ contactId: schema.enrollment.contactId })
        .from(schema.enrollment)
        .where(and(eq(schema.enrollment.sequenceId, row.id), inArray(schema.enrollment.contactId, unique)))
    ).map((r) => r.contactId),
  );
  const suppressed = await suppressionsFor(
    actor.organizationId,
    contacts.flatMap((c) => (c.email ? [c.email] : [])),
  );

  const result: EnrollResult = { enrolled: [], skipped: [] };
  const skip = (contactId: string, reason: SkipReason) =>
    result.skipped.push({ contactId, reason, message: SKIP_REASON_LABELS[reason] });
  const accepted: string[] = [];
  for (const contactId of unique) {
    const c = byId.get(contactId);
    if (!c) skip(contactId, "not_found");
    else if (enrolledAlready.has(c.id)) skip(c.id, "already_enrolled");
    else if (!c.email) skip(c.id, "missing_email");
    else if (suppressed.get(c.email.toLowerCase())?.kind === "email") skip(c.id, "suppressed_email");
    else if (suppressed.get(c.email.toLowerCase())?.kind === "domain") skip(c.id, "suppressed_domain");
    else if (c.emailStatus === "invalid") skip(c.id, "invalid_email");
    else if (c.emailStatus === "disposable") skip(c.id, "disposable_email");
    else if (c.stage === "do_not_contact") skip(c.id, "do_not_contact");
    else accepted.push(c.id);
  }

  if (accepted.length) {
    const steps = await orderedSteps(row.id);
    const firstIndex = Math.max(0, nextEnabledIndex(steps, 0));
    const first = steps[firstIndex];
    const nextRunAt = new Date(Date.now() + (first ? stepDelayMs(first) : 0));
    const inserted = await db
      .insert(schema.enrollment)
      .values(
        accepted.map((contactId) => ({
          organizationId: actor.organizationId,
          sequenceId: row.id,
          contactId,
          currentStep: firstIndex,
          nextRunAt,
          enrolledById: actor.userId,
        })),
      )
      .onConflictDoNothing()
      .returning({ contactId: schema.enrollment.contactId });
    const insertedIds = new Set(inserted.map((r) => r.contactId));
    for (const contactId of accepted) {
      if (insertedIds.has(contactId)) result.enrolled.push(contactId);
      else skip(contactId, "already_enrolled");
    }
    await touchSequence(row.id);
    for (const contactId of result.enrolled) {
      await recordEvent({
        organizationId: actor.organizationId,
        type: "contact_added_to_sequence",
        summary: `Added to the sequence ${row.name}`,
        contactId,
        companyId: byId.get(contactId)?.companyId ?? null,
        actorUserId: actor.userId,
        metadata: { sequenceId: row.id },
      });
    }
  }
  await audit(actor, "sequence.enroll", "sequence", row.id, {
    enrolled: result.enrolled.length,
    skipped: result.skipped.length,
  });
  return result;
}

export async function removeOrStopContacts(
  actor: Actor,
  input: unknown,
): Promise<{ updated: number; mode: "remove" | "stop" | "finish" }> {
  const { sequenceIds, contactIds, mode } = removeOrStopSchema.parse(input);
  const unique = [...new Set(sequenceIds)];
  const found = await db
    .select({ id: schema.sequence.id })
    .from(schema.sequence)
    .where(and(eq(schema.sequence.organizationId, actor.organizationId), inArray(schema.sequence.id, unique)));
  if (found.length !== unique.length) throw notFound("Sequence not found.");
  const STATUS_FOR_MODE = { remove: "removed", stop: "paused", finish: "finished" } as const;
  const status = STATUS_FOR_MODE[mode];
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.enrollment)
      .set({ status, nextRunAt: null })
      .where(
        and(
          eq(schema.enrollment.organizationId, actor.organizationId),
          inArray(schema.enrollment.sequenceId, unique),
          inArray(schema.enrollment.contactId, contactIds),
          ne(schema.enrollment.status, status),
        ),
      )
      .returning({ id: schema.enrollment.id });
    for (const sequenceId of unique) {
      await holdMessages(tx, { sequenceId, contactIds }, `Enrollment ${status} by a teammate.`);
    }
    return rows.length;
  });
  await audit(actor, `sequence.enrollment.${mode}`, "sequence", unique.length === 1 ? unique[0] : null, {
    sequences: unique.length,
    updated,
  });
  return { updated, mode };
}

/** Resume paused enrollments: they continue from their current step now. */
export async function resumeContacts(actor: Actor, id: string, input: unknown): Promise<{ updated: number }> {
  const row = await findSequence(actor, id);
  const { contactIds } = addContactsSchema.parse(input);
  const rows = await db
    .update(schema.enrollment)
    .set({ status: "active", nextRunAt: new Date() })
    .where(
      and(
        eq(schema.enrollment.sequenceId, row.id),
        inArray(schema.enrollment.contactId, contactIds),
        eq(schema.enrollment.status, "paused"),
      ),
    )
    .returning({ id: schema.enrollment.id });
  await audit(actor, "sequence.enrollment.resume", "sequence", row.id, { updated: rows.length });
  return { updated: rows.length };
}

const AUTO_REPLY_SUBJECT =
  /\b(out of (the )?office|auto(matic)?[- ]?reply|autoreply|away from (the )?office|on (vacation|holiday|leave)|abwesenheit|absence)\b/i;

/**
 * Out-of-office detection for a recorded reply: auto-reply headers (RFC 3834 Auto-Submitted,
 * X-Autoreply, X-Autorespond, Precedence auto_reply) or a typical auto-reply subject.
 */
export function isAutoReply(subject?: string, headers?: Record<string, string>): boolean {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]) return true;
  if (h.precedence && ["auto_reply", "auto-reply"].includes(h.precedence)) return true;
  return Boolean(subject && AUTO_REPLY_SUBJECT.test(subject));
}

/**
 * Record replies (inbox sync isn't built yet). With stop-on-reply the enrollment stops and unsent
 * messages are held back; without it the enrollment keeps going. An out-of-office auto-reply pauses
 * the enrollment instead. The ruleset decides what happens to other contacts at the same account.
 */
export async function markReplied(
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ updated: number; outOfOffice: boolean; sameAccount: number }> {
  const row = await findSequence(actor, id);
  const { contactIds, subject, headers } = markRepliedSchema.parse(input);
  const outOfOffice = isAutoReply(subject, headers);
  const ruleset = rulesetOf(row);

  if (outOfOffice) {
    const paused = await db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.enrollment)
        .set({ status: "paused", nextRunAt: null })
        .where(
          and(
            eq(schema.enrollment.sequenceId, row.id),
            inArray(schema.enrollment.contactId, contactIds),
            eq(schema.enrollment.status, "active"),
          ),
        )
        .returning({ contactId: schema.enrollment.contactId });
      if (rows.length) {
        await holdMessages(
          tx,
          { sequenceId: row.id, contactIds: rows.map((r) => r.contactId) },
          "An out-of-office reply arrived, so the contact was paused.",
        );
      }
      return rows.length;
    });
    await audit(actor, "sequence.enrollment.out_of_office", "sequence", row.id, { updated: paused });
    return { updated: paused, outOfOffice: true, sameAccount: 0 };
  }

  const replied = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.enrollment)
      .set(row.stopOnReply ? { status: "replied", nextRunAt: null } : { status: "replied" })
      .where(
        and(
          eq(schema.enrollment.sequenceId, row.id),
          inArray(schema.enrollment.contactId, contactIds),
          inArray(schema.enrollment.status, ["active", "paused"]),
        ),
      )
      .returning({ contactId: schema.enrollment.contactId });
    if (row.stopOnReply && rows.length) {
      await holdMessages(
        tx,
        { sequenceId: row.id, contactIds: rows.map((r) => r.contactId) },
        "The contact replied, so the sequence stopped.",
      );
    }
    if (rows.length) {
      await tx
        .update(schema.contact)
        .set({ stage: "replied" })
        .where(
          and(
            eq(schema.contact.organizationId, actor.organizationId),
            inArray(
              schema.contact.id,
              rows.map((r) => r.contactId),
            ),
            inArray(schema.contact.stage, ["new", "contacted"]),
          ),
        );
    }
    return rows.map((r) => r.contactId);
  });

  // Ruleset: other contacts at the same account.
  let sameAccount = 0;
  if (replied.length && ruleset.sameAccountReply !== "nothing") {
    const companies = await db
      .selectDistinct({ companyId: schema.contact.companyId })
      .from(schema.contact)
      .where(and(inArray(schema.contact.id, replied), isNotNull(schema.contact.companyId)));
    const companyIds = companies.map((c) => c.companyId).filter((v): v is string => Boolean(v));
    if (companyIds.length) {
      const colleagues = db
        .select({ id: schema.contact.id })
        .from(schema.contact)
        .where(
          and(eq(schema.contact.organizationId, actor.organizationId), inArray(schema.contact.companyId, companyIds)),
        );
      const status = ruleset.sameAccountReply === "finish" ? "finished" : "paused";
      const rows = await db
        .update(schema.enrollment)
        .set({ status, nextRunAt: null })
        .where(
          and(
            eq(schema.enrollment.sequenceId, row.id),
            inArray(schema.enrollment.contactId, colleagues),
            eq(schema.enrollment.status, "active"),
          ),
        )
        .returning({ contactId: schema.enrollment.contactId });
      sameAccount = rows.length;
      if (rows.length) {
        await holdMessages(
          db,
          { sequenceId: row.id, contactIds: rows.map((r) => r.contactId) },
          "Someone else at this account replied.",
        );
      }
    }
  }

  for (const contactId of replied) {
    await recordEvent({
      organizationId: actor.organizationId,
      type: "email_replied",
      summary: `Replied to the sequence ${row.name}`,
      contactId,
      actorUserId: actor.userId,
      metadata: { sequenceId: row.id, mailboxId: row.mailboxId },
    });
  }
  await audit(actor, "sequence.enrollment.replied", "sequence", row.id, { updated: replied.length, sameAccount });
  return { updated: replied.length, outOfOffice: false, sameAccount };
}

export interface EnrollmentView {
  id: string;
  status: (typeof schema.enrollment.$inferSelect)["status"];
  currentStep: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Why the last email for this contact wasn't sent, when it was held back. */
  notSentReason: string | null;
  contact: {
    id: string;
    name: string;
    email: string | null;
    emailStatus: string;
    title: string | null;
    companyName: string | null;
  };
}

export const ENROLLMENT_FILTERS = [...schema.enrollment.status.enumValues, "not_sent"] as const;

export const enrollmentsQuerySchema = z.object({
  status: z.enum(ENROLLMENT_FILTERS).optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listEnrollments(
  actor: Actor,
  id: string,
  page: Page,
  input: unknown,
): Promise<{ enrollments: EnrollmentView[]; total: number; counts: Record<string, number> }> {
  const filters = enrollmentsQuerySchema.parse(input ?? {});
  const row = await findSequence(actor, id);
  const notSent = sql`exists (select 1 from outbound_message nm where nm.enrollment_id = ${schema.enrollment.id} and nm.status = 'blocked')`;
  const where: SQL[] = [eq(schema.enrollment.sequenceId, row.id)];
  if (filters.status === "not_sent") where.push(notSent, eq(schema.enrollment.status, "paused"));
  else if (filters.status) where.push(eq(schema.enrollment.status, filters.status));
  if (filters.q) {
    const pattern = escapeLike(filters.q);
    where.push(
      sql`(${schema.contact.email} ilike ${pattern} or (coalesce(${schema.contact.firstName}, '') || ' ' || coalesce(${schema.contact.lastName}, '')) ilike ${pattern})`,
    );
  }
  const [total] = await db
    .select({ n: count() })
    .from(schema.enrollment)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
    .where(and(...where));
  const rows = await db
    .select({
      id: schema.enrollment.id,
      status: schema.enrollment.status,
      currentStep: schema.enrollment.currentStep,
      nextRunAt: schema.enrollment.nextRunAt,
      createdAt: schema.enrollment.createdAt,
      updatedAt: schema.enrollment.updatedAt,
      contactId: schema.contact.id,
      firstName: schema.contact.firstName,
      lastName: schema.contact.lastName,
      email: schema.contact.email,
      emailStatus: schema.contact.emailStatus,
      title: schema.contact.title,
      companyName: schema.company.name,
      notSentReason: sql<
        string | null
      >`(select bm.blocked_reason from outbound_message bm where bm.enrollment_id = ${schema.enrollment.id} and bm.status = 'blocked' order by bm.created_at desc limit 1)`,
    })
    .from(schema.enrollment)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
    .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
    .where(and(...where))
    .orderBy(desc(schema.enrollment.createdAt), asc(schema.enrollment.id))
    .limit(page.perPage)
    .offset(page.offset);
  const grouped = await db
    .select({ status: schema.enrollment.status, n: count() })
    .from(schema.enrollment)
    .where(eq(schema.enrollment.sequenceId, row.id))
    .groupBy(schema.enrollment.status);
  const [notSentCount] = await db
    .select({ n: count() })
    .from(schema.enrollment)
    .where(and(eq(schema.enrollment.sequenceId, row.id), eq(schema.enrollment.status, "paused"), notSent));
  const counts: Record<string, number> = Object.fromEntries(ENROLLMENT_FILTERS.map((s) => [s, 0]));
  for (const g of grouped) counts[g.status] = g.n;
  counts.not_sent = notSentCount?.n ?? 0;
  return {
    total: total?.n ?? 0,
    counts,
    enrollments: rows.map((r) => ({
      id: r.id,
      status: r.status,
      currentStep: r.currentStep,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      notSentReason: r.status === "paused" ? r.notSentReason : null,
      contact: {
        id: r.contactId,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Unnamed contact",
        email: r.email,
        emailStatus: r.emailStatus,
        title: r.title,
        companyName: r.companyName,
      },
    })),
  };
}

export interface DetailedStats extends SequenceStats {
  steps: {
    stepId: string;
    position: number;
    type: StepRow["type"];
    enabled: boolean;
    sent: number;
    pendingReview: number;
    blocked: number;
    bounced: number;
    opened: number;
    clicked: number;
    replied: number;
    variants: { variantId: string; label: string; active: boolean; sent: number; opened: number; replied: number }[];
  }[];
}

export async function sequenceStats(actor: Actor, id: string): Promise<DetailedStats> {
  const row = await findSequence(actor, id);
  const stats = (await statsFor([row])).get(row.id) ?? emptyStats();
  const steps = await orderedSteps(row.id);
  const variants = await variantsByStep(steps.map((s) => s.id));
  const perMessage = await db
    .select({
      stepId: schema.outboundMessage.stepId,
      variantId: schema.outboundMessage.variantId,
      status: schema.outboundMessage.status,
      n: count(),
    })
    .from(schema.outboundMessage)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(and(eq(schema.enrollment.sequenceId, row.id), isNotNull(schema.outboundMessage.stepId)))
    .groupBy(schema.outboundMessage.stepId, schema.outboundMessage.variantId, schema.outboundMessage.status);
  const events = await db
    .select({
      stepId: sql<string | null>`${schema.activity.metadata}->>'stepId'`,
      variantId: sql<string | null>`${schema.activity.metadata}->>'variantId'`,
      type: schema.activity.type,
      n: sql<number>`count(distinct ${schema.activity.metadata}->>'messageId')::int`,
    })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.organizationId, actor.organizationId),
        inArray(schema.activity.type, ["email_opened", "email_clicked"]),
        sql`${schema.activity.metadata}->>'sequenceId' = ${row.id}`,
      ),
    )
    .groupBy(
      sql`${schema.activity.metadata}->>'stepId'`,
      sql`${schema.activity.metadata}->>'variantId'`,
      schema.activity.type,
    );
  // Replies are attributed to the last email sent to the contact before they replied.
  const replies = await db
    .select({ stepId: schema.outboundMessage.stepId, variantId: schema.outboundMessage.variantId, n: count() })
    .from(schema.enrollment)
    .innerJoin(
      schema.outboundMessage,
      and(
        eq(schema.outboundMessage.enrollmentId, schema.enrollment.id),
        eq(schema.outboundMessage.status, "sent"),
        sql`${schema.outboundMessage.sentAt} = (select max(m2.sent_at) from outbound_message m2 where m2.enrollment_id = ${schema.enrollment.id} and m2.status = 'sent')`,
      ),
    )
    .where(and(eq(schema.enrollment.sequenceId, row.id), eq(schema.enrollment.status, "replied")))
    .groupBy(schema.outboundMessage.stepId, schema.outboundMessage.variantId);

  const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + Number(r.n), 0);
  return {
    ...stats,
    steps: steps.map((s) => {
      const msg = perMessage.filter((r) => r.stepId === s.id);
      const ev = events.filter((r) => r.stepId === s.id);
      const rep = replies.filter((r) => r.stepId === s.id);
      return {
        stepId: s.id,
        position: s.position,
        type: s.type,
        enabled: s.enabled,
        sent: sum(msg.filter((r) => r.status === "sent")),
        pendingReview: sum(msg.filter((r) => r.status === "pending_review")),
        blocked: sum(msg.filter((r) => r.status === "blocked")),
        bounced: sum(msg.filter((r) => r.status === "bounced")),
        opened: sum(ev.filter((r) => r.type === "email_opened")),
        clicked: sum(ev.filter((r) => r.type === "email_clicked")),
        replied: sum(rep),
        variants: (variants.get(s.id) ?? []).map((v) => ({
          variantId: v.id,
          label: v.label,
          active: v.active,
          sent: sum(msg.filter((r) => r.variantId === v.id && r.status === "sent")),
          opened: sum(ev.filter((r) => r.variantId === v.id && r.type === "email_opened")),
          replied: sum(rep.filter((r) => r.variantId === v.id)),
        })),
      };
    }),
  };
}

/** Contacts not yet in this sequence that match `q`, for the "add people" picker. */
export async function enrollmentCandidates(actor: Actor, id: string, q: string) {
  const row = await findSequence(actor, id);
  const current = await db
    .select({ id: schema.enrollment.contactId })
    .from(schema.enrollment)
    .where(eq(schema.enrollment.sequenceId, row.id));
  return searchContacts(actor, q, { excludeIds: current.map((r) => r.id) });
}

/** Contacts in a list that aren't in this sequence yet (for "Add contacts ▾ → from a list"). */
export async function listContactIds(actor: Actor, listId: string): Promise<string[]> {
  const [list] = await db
    .select({ id: schema.list.id })
    .from(schema.list)
    .where(
      and(
        eq(schema.list.id, listId),
        eq(schema.list.organizationId, actor.organizationId),
        eq(schema.list.entityType, "contact"),
      ),
    )
    .limit(1);
  if (!list) throw notFound("List not found.");
  const rows = await db
    .select({ id: schema.listMember.entityId })
    .from(schema.listMember)
    .where(eq(schema.listMember.listId, list.id))
    .limit(1000);
  return rows.map((r) => r.id);
}
