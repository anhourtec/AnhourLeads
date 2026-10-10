import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import { searchContacts } from "./lists";
import { findMailbox, mailboxIssues } from "./mailboxes";
import { suppressionsFor } from "./sending";

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

export const STEP_TYPES = ["auto_email", "manual_email", "call", "task"] as const;
export const REVIEW_MODES = ["all", "first_step", "none"] as const;

export const stepSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    type: z.enum(STEP_TYPES),
    waitDays: z.number().int().min(0, "Wait 0 days or more.").max(365, "Wait at most 365 days.").default(0),
    subject: z
      .string()
      .trim()
      .max(300)
      .nullish()
      .transform((v) => v || null),
    body: z
      .string()
      .max(20_000)
      .nullish()
      .transform((v) => (v?.trim() ? v : null)),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (step.type === "auto_email") {
      if (!step.subject)
        ctx.addIssue({ code: "custom", path: ["subject"], message: "Automatic emails need a subject." });
      if (!step.body) ctx.addIssue({ code: "custom", path: ["body"], message: "Automatic emails need a body." });
    }
  });

export type StepInput = z.infer<typeof stepSchema>;

const settings = {
  name: z.string().trim().min(1, "Name the sequence.").max(120),
  mailboxId: z.string().min(1).max(100).nullish(),
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  stopOnReply: z.boolean(),
  reviewMode: z.enum(REVIEW_MODES),
};

export const createSequenceSchema = z
  .object({
    name: settings.name,
    mailboxId: settings.mailboxId,
    trackOpens: settings.trackOpens.default(false),
    trackClicks: settings.trackClicks.default(false),
    stopOnReply: settings.stopOnReply.default(true),
    reviewMode: settings.reviewMode.default("all"),
    steps: z.array(stepSchema).max(30, "At most 30 steps.").default([]),
  })
  .strict();

export const updateSequenceSchema = z.object(settings).partial().strict();

export const replaceStepsSchema = z.object({ steps: z.array(stepSchema).max(30, "At most 30 steps.") }).strict();

export const searchSequencesSchema = z.object({
  q: z.string().trim().max(200).optional(),
  qName: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
  per_page: z.union([z.number(), z.string()]).optional(),
});

const idList = z.array(z.string().min(1).max(100)).min(1, "Pass at least one contact id.").max(1000);

export const addContactsSchema = z.object({ contactIds: idList }).strict();
export const markRepliedSchema = z.object({ contactIds: idList }).strict();
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
}

export interface StepView {
  id: string;
  position: number;
  type: StepRow["type"];
  waitDays: number;
  subject: string | null;
  body: string | null;
}

export interface SequenceView {
  id: string;
  name: string;
  status: SequenceRow["status"];
  mailboxId: string | null;
  mailbox: { id: string; email: string; displayName: string | null; readyToSend: boolean; issues: string[] } | null;
  trackOpens: boolean;
  trackClicks: boolean;
  stopOnReply: boolean;
  reviewMode: SequenceRow["reviewMode"];
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
});

async function statsFor(ids: string[]): Promise<Map<string, SequenceStats>> {
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
    if (r.status in s) s[r.status as keyof SequenceStats] += r.n;
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
  const [stats, steps, mailboxes] = await Promise.all([
    statsFor(ids),
    stepCounts(ids),
    mailboxIds.length
      ? db
          .select()
          .from(schema.mailbox)
          .where(and(eq(schema.mailbox.organizationId, organizationId), inArray(schema.mailbox.id, mailboxIds)))
      : Promise.resolve([]),
  ]);
  const byId = new Map(mailboxes.map((m) => [m.id, m]));
  return rows.map((r) => {
    const m = r.mailboxId ? byId.get(r.mailboxId) : undefined;
    const issues = m ? mailboxIssues(m) : [];
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      mailboxId: r.mailboxId,
      mailbox: m
        ? { id: m.id, email: m.email, displayName: m.displayName, readyToSend: issues.length === 0, issues }
        : null,
      trackOpens: r.trackOpens,
      trackClicks: r.trackClicks,
      stopOnReply: r.stopOnReply,
      reviewMode: r.reviewMode,
      stepCount: steps.get(r.id) ?? 0,
      stats: stats.get(r.id) ?? emptyStats(),
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

function stepView(s: StepRow): StepView {
  return { id: s.id, position: s.position, type: s.type, waitDays: s.waitDays, subject: s.subject, body: s.body };
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

/* -------------------------------------------------------------------------- */
/* Sequences                                                                  */
/* -------------------------------------------------------------------------- */

export async function searchSequences(
  actor: Actor,
  input: unknown,
  page: Page,
): Promise<{ sequences: SequenceView[]; total: number }> {
  const data = searchSequencesSchema.parse(input ?? {});
  const where: SQL[] = [eq(schema.sequence.organizationId, actor.organizationId)];
  const q = data.q || data.qName;
  if (q) where.push(ilike(schema.sequence.name, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  if (data.status) where.push(eq(schema.sequence.status, data.status));
  const [total] = await db
    .select({ n: count() })
    .from(schema.sequence)
    .where(and(...where));
  const rows = await db
    .select()
    .from(schema.sequence)
    .where(and(...where))
    .orderBy(desc(schema.sequence.updatedAt), asc(schema.sequence.id))
    .limit(page.perPage)
    .offset(page.offset);
  return { sequences: await toViews(actor.organizationId, rows), total: total?.n ?? 0 };
}

export async function getSequence(actor: Actor, id: string): Promise<{ sequence: SequenceView; steps: StepView[] }> {
  const row = await findSequence(actor, id);
  const [view] = await toViews(actor.organizationId, [row]);
  return { sequence: view, steps: (await orderedSteps(row.id)).map(stepView) };
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

export async function createSequence(actor: Actor, input: unknown) {
  const data = createSequenceSchema.parse(input);
  if (data.mailboxId) await assertMailboxUsable(actor, data.mailboxId, false);
  const sequenceId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.sequence)
      .values({
        organizationId: actor.organizationId,
        name: data.name,
        mailboxId: data.mailboxId ?? null,
        trackOpens: data.trackOpens,
        trackClicks: data.trackClicks,
        stopOnReply: data.stopOnReply,
        reviewMode: data.reviewMode,
        createdById: actor.userId,
      })
      .returning({ id: schema.sequence.id });
    if (data.steps.length) {
      await tx.insert(schema.sequenceStep).values(
        data.steps.map((s, i) => ({
          sequenceId: row.id,
          position: i + 1,
          type: s.type,
          waitDays: s.waitDays,
          subject: s.subject,
          body: s.body,
        })),
      );
    }
    return row.id;
  });
  await audit(actor, "sequence.create", "sequence", sequenceId, { name: data.name, steps: data.steps.length });
  return getSequence(actor, sequenceId);
}

export async function updateSequence(actor: Actor, id: string, input: unknown) {
  const row = await findSequence(actor, id);
  const data = updateSequenceSchema.parse(input);
  if (row.status === "archived") throw new HttpError(422, "Archived sequences can't be changed.");
  if (data.mailboxId !== undefined) {
    if (data.mailboxId) await assertMailboxUsable(actor, data.mailboxId, row.status === "active");
    else if (row.status === "active") {
      throw new HttpError(422, "Active sequences need a mailbox. Pause the sequence first.", [
        { path: "mailboxId", message: "Required while active." },
      ]);
    }
  }
  const patch: Partial<typeof schema.sequence.$inferInsert> = { ...data, mailboxId: data.mailboxId ?? undefined };
  if (data.mailboxId === null) patch.mailboxId = null;
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
  return (await orderedSteps(row.id)).map(stepView);
}

export async function addStep(actor: Actor, id: string, input: unknown): Promise<StepView[]> {
  const row = await editableSequence(actor, id);
  const step = stepSchema.parse(input);
  const steps = await orderedSteps(row.id);
  if (steps.length >= 30) throw new HttpError(422, "A sequence can have at most 30 steps.");
  await db.insert(schema.sequenceStep).values({
    sequenceId: row.id,
    position: steps.length + 1,
    type: step.type,
    waitDays: step.waitDays,
    subject: step.subject,
    body: step.body,
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
  const merged = stepSchema.parse({
    type: current.type,
    waitDays: current.waitDays,
    subject: current.subject,
    body: current.body,
    ...raw,
    id: undefined,
  });
  await db
    .update(schema.sequenceStep)
    .set({ type: merged.type, waitDays: merged.waitDays, subject: merged.subject, body: merged.body })
    .where(eq(schema.sequenceStep.id, current.id));
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
      const values = { position: i + 1, type: s.type, waitDays: s.waitDays, subject: s.subject, body: s.body };
      if (s.id) await tx.update(schema.sequenceStep).set(values).where(eq(schema.sequenceStep.id, s.id));
      else await tx.insert(schema.sequenceStep).values({ ...values, sequenceId: row.id });
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
  if (!row.mailboxId) problems.push({ path: "mailboxId", message: "Pick a mailbox to send from." });
  else {
    const mailbox = await findMailbox(actor, row.mailboxId);
    for (const issue of mailboxIssues(mailbox)) problems.push({ path: "mailboxId", message: issue });
  }
  if (problems.length) throw new HttpError(422, problems[0].message, problems);
  if (row.status !== "active") {
    await db.update(schema.sequence).set({ status: "active" }).where(eq(schema.sequence.id, row.id));
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
    const [first] = await orderedSteps(row.id);
    const nextRunAt = new Date(Date.now() + (first?.waitDays ?? 0) * 86_400_000);
    const inserted = await db
      .insert(schema.enrollment)
      .values(
        accepted.map((contactId) => ({
          organizationId: actor.organizationId,
          sequenceId: row.id,
          contactId,
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

/**
 * Record replies (inbox sync isn't built yet). With stop-on-reply the enrollment stops and unsent
 * messages are held back; without it the enrollment keeps going.
 */
export async function markReplied(actor: Actor, id: string, input: unknown): Promise<{ updated: number }> {
  const row = await findSequence(actor, id);
  const { contactIds } = markRepliedSchema.parse(input);
  const updated = await db.transaction(async (tx) => {
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
    return rows.length;
  });
  await audit(actor, "sequence.enrollment.replied", "sequence", row.id, { updated });
  return { updated };
}

export interface EnrollmentView {
  id: string;
  status: (typeof schema.enrollment.$inferSelect)["status"];
  currentStep: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string;
    email: string | null;
    emailStatus: string;
    title: string | null;
    companyName: string | null;
  };
}

export const enrollmentsQuerySchema = z.object({
  status: z.enum(schema.enrollment.status.enumValues).optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listEnrollments(
  actor: Actor,
  id: string,
  page: Page,
  input: unknown,
): Promise<{ enrollments: EnrollmentView[]; total: number }> {
  const filters = enrollmentsQuerySchema.parse(input ?? {});
  const row = await findSequence(actor, id);
  const where: SQL[] = [eq(schema.enrollment.sequenceId, row.id)];
  if (filters.status) where.push(eq(schema.enrollment.status, filters.status));
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
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
    })
    .from(schema.enrollment)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
    .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
    .where(and(...where))
    .orderBy(desc(schema.enrollment.createdAt), asc(schema.enrollment.id))
    .limit(page.perPage)
    .offset(page.offset);
  return {
    total: total?.n ?? 0,
    enrollments: rows.map((r) => ({
      id: r.id,
      status: r.status,
      currentStep: r.currentStep,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
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
  steps: { stepId: string; position: number; type: StepRow["type"]; sent: number; pendingReview: number }[];
}

export async function sequenceStats(actor: Actor, id: string): Promise<DetailedStats> {
  const row = await findSequence(actor, id);
  const stats = (await statsFor([row.id])).get(row.id) ?? emptyStats();
  const steps = await orderedSteps(row.id);
  const perStep = await db
    .select({ stepId: schema.outboundMessage.stepId, status: schema.outboundMessage.status, n: count() })
    .from(schema.outboundMessage)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(and(eq(schema.enrollment.sequenceId, row.id), isNotNull(schema.outboundMessage.stepId)))
    .groupBy(schema.outboundMessage.stepId, schema.outboundMessage.status);
  const count_ = (stepId: string, status: string) =>
    perStep.filter((r) => r.stepId === stepId && r.status === status).reduce((a, r) => a + r.n, 0);
  return {
    ...stats,
    steps: steps.map((s) => ({
      stepId: s.id,
      position: s.position,
      type: s.type,
      sent: count_(s.id, "sent"),
      pendingReview: count_(s.id, "pending_review"),
    })),
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
