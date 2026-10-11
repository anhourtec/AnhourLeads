import "server-only";

import { and, count, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import { emitEvent as recordEvent } from "./engage-events";
import { contactName, rulesetOf } from "./sending";
import { verifyTrackingToken } from "./tracking-tokens";

/**
 * Open and click tracking (only for sequences that turn it on). Each hit records an activity event;
 * the sequence's ruleset may react: a call task after N opens, or finishing the contact on a click.
 */

async function messageContext(messageId: string) {
  const [row] = await db
    .select({ message: schema.outboundMessage, enrollment: schema.enrollment, sequence: schema.sequence })
    .from(schema.outboundMessage)
    .leftJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .leftJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
    .where(and(eq(schema.outboundMessage.id, messageId), eq(schema.outboundMessage.status, "sent")))
    .limit(1);
  return row ?? null;
}

const metaFor = (ctx: NonNullable<Awaited<ReturnType<typeof messageContext>>>) => ({
  messageId: ctx.message.id,
  mailboxId: ctx.message.mailboxId,
  sequenceId: ctx.sequence?.id ?? null,
  enrollmentId: ctx.message.enrollmentId,
  stepId: ctx.message.stepId,
  variantId: ctx.message.variantId,
});

export async function recordOpen(token: string): Promise<void> {
  const messageId = verifyTrackingToken("o", token);
  if (!messageId) return;
  try {
    const ctx = await messageContext(messageId);
    if (!ctx?.sequence?.trackOpens) return;
    const [contact] = ctx.message.contactId
      ? await db.select().from(schema.contact).where(eq(schema.contact.id, ctx.message.contactId)).limit(1)
      : [];
    await recordEvent({
      organizationId: ctx.message.organizationId,
      type: "email_opened",
      summary: `Opened: ${ctx.message.subject}`,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      metadata: metaFor(ctx),
    });
    const ruleset = rulesetOf(ctx.sequence);
    if (!ruleset.openCallTask.enabled || !ctx.enrollment || !contact) return;
    if (!["active", "paused"].includes(ctx.enrollment.status)) return;
    const [opens] = await db
      .select({ n: count() })
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.organizationId, ctx.message.organizationId),
          eq(schema.activity.type, "email_opened"),
          sql`${schema.activity.metadata}->>'enrollmentId' = ${ctx.enrollment.id}`,
        ),
      );
    // Exactly at the threshold, so the task is created once.
    if ((opens?.n ?? 0) !== ruleset.openCallTask.opens) return;
    const [task] = await db
      .insert(schema.task)
      .values({
        organizationId: ctx.message.organizationId,
        assigneeId: ctx.sequence.ownerId ?? ctx.enrollment.enrolledById ?? contact.ownerId,
        contactId: contact.id,
        companyId: contact.companyId,
        enrollmentId: ctx.enrollment.id,
        type: "call",
        priority: "high",
        title: `Call ${contactName(contact)}: opened ${ctx.sequence.name} emails ${opens?.n} times`.slice(0, 200),
        dueAt: new Date(),
      })
      .returning({ id: schema.task.id, title: schema.task.title });
    await recordEvent({
      organizationId: ctx.message.organizationId,
      type: "task_created",
      summary: `Task created: ${task.title}`,
      contactId: contact.id,
      companyId: contact.companyId,
      metadata: { taskId: task.id, sequenceId: ctx.sequence.id, cause: "open_count" },
    });
  } catch (error) {
    log.error("open tracking failed", { component: "tracking", error });
  }
}

/** Record a click and return where to send the visitor, or null when the link isn't one of ours. */
export async function recordClick(token: string, url: string): Promise<string | null> {
  const messageId = verifyTrackingToken("c", token, url);
  const target = safeRedirect(url);
  if (!messageId || !target) return null;
  await clickRules(messageId, url);
  return target;
}

async function clickRules(messageId: string, url: string): Promise<void> {
  try {
    const ctx = await messageContext(messageId);
    if (!ctx?.sequence?.trackClicks) return;
    const [contact] = ctx.message.contactId
      ? await db.select().from(schema.contact).where(eq(schema.contact.id, ctx.message.contactId)).limit(1)
      : [];
    await recordEvent({
      organizationId: ctx.message.organizationId,
      type: "email_clicked",
      summary: `Clicked a link in: ${ctx.message.subject}`,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      metadata: { ...metaFor(ctx), url: url.slice(0, 500) },
    });
    const ruleset = rulesetOf(ctx.sequence);
    if (!ruleset.finishOnClick || !ctx.enrollment) return;
    const finished = await db
      .update(schema.enrollment)
      .set({ status: "finished", nextRunAt: null })
      .where(and(eq(schema.enrollment.id, ctx.enrollment.id), inArray(schema.enrollment.status, ["active", "paused"])))
      .returning({ id: schema.enrollment.id });
    if (!finished.length) return;
    await db
      .update(schema.outboundMessage)
      .set({ status: "blocked", blockedReason: "The contact clicked a link, so the sequence finished." })
      .where(
        and(
          eq(schema.outboundMessage.enrollmentId, ctx.enrollment.id),
          inArray(schema.outboundMessage.status, ["pending_review", "queued", "failed"]),
        ),
      );
    await recordEvent({
      organizationId: ctx.message.organizationId,
      type: "contact_finished_sequence",
      summary: `Finished ${ctx.sequence.name} after clicking a link`,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      metadata: { sequenceId: ctx.sequence.id, enrollmentId: ctx.enrollment.id, cause: "link_click" },
    });
  } catch (error) {
    log.error("click tracking failed", { component: "tracking", error });
  }
}

/** Only http(s) destinations are followed; anything else goes nowhere. */
export function safeRedirect(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
