import "server-only";

import { and, asc, count, desc, eq, inArray, isNotNull, lte, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";
import { log } from "@/server/log";
import { redis } from "@/server/redis";
import { workspaceBrand } from "@/server/tenancy/brand";

import { audit } from "./audit";
import {
  inSendingWindow,
  type MailboxRow,
  mailboxIssues,
  mailboxTransport,
  sentTodayCount,
  smtpErrorMessage,
} from "./mailboxes";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const logger = log.child({ component: "sending" });

type SequenceRow = typeof schema.sequence.$inferSelect;
type StepRow = typeof schema.sequenceStep.$inferSelect;
type EnrollmentRow = typeof schema.enrollment.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;
type MessageRow = typeof schema.outboundMessage.$inferSelect;

const DAY_MS = 86_400_000;
const BATCH = 200;

/* -------------------------------------------------------------------------- */
/* Suppression                                                                */
/* -------------------------------------------------------------------------- */

export interface SuppressionHit {
  kind: "email" | "domain";
  reason: (typeof schema.suppression.$inferSelect)["reason"];
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** Suppression matches for each email (lowercased key): exact email first, then its domain. */
export async function suppressionsFor(organizationId: string, emails: string[]): Promise<Map<string, SuppressionHit>> {
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  const map = new Map<string, SuppressionHit>();
  if (!lower.length) return map;
  const domains = [...new Set(lower.map(domainOf).filter(Boolean))];
  const rows = await db
    .select({ kind: schema.suppression.kind, value: schema.suppression.value, reason: schema.suppression.reason })
    .from(schema.suppression)
    .where(
      and(
        eq(schema.suppression.organizationId, organizationId),
        or(
          and(eq(schema.suppression.kind, "email"), inArray(sql`lower(${schema.suppression.value})`, lower)),
          domains.length
            ? and(eq(schema.suppression.kind, "domain"), inArray(sql`lower(${schema.suppression.value})`, domains))
            : sql`false`,
        ),
      ),
    );
  const emailHits = new Map(rows.filter((r) => r.kind === "email").map((r) => [r.value.toLowerCase(), r]));
  const domainHits = new Map(rows.filter((r) => r.kind === "domain").map((r) => [r.value.toLowerCase(), r]));
  for (const email of lower) {
    const hit = emailHits.get(email) ?? domainHits.get(domainOf(email));
    if (hit) map.set(email, { kind: hit.kind, reason: hit.reason });
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Unsubscribe tokens                                                         */
/* -------------------------------------------------------------------------- */

function sign(payload: string): Buffer {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`unsubscribe:${payload}`).digest();
}

/** Token for the public unsubscribe link: the workspace and contact ids plus an HMAC over both. */
export function unsubscribeToken(organizationId: string, contactId: string): string {
  const payload = `${organizationId}:${contactId}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload).toString("base64url")}`;
}

export function verifyUnsubscribeToken(token: string): { organizationId: string; contactId: string } | null {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined || token.length > 400) return null;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const [organizationId, contactId, rest] = payload.split(":");
  if (!organizationId || !contactId || rest !== undefined) return null;
  const expected = sign(payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { organizationId, contactId };
}

/** Public origin for links in a workspace's emails: its verified hostname, else the installation URL. */
export async function workspaceOrigin(organizationId: string): Promise<string> {
  const [domain] = await db
    .select({ hostname: schema.workspaceDomain.hostname })
    .from(schema.workspaceDomain)
    .where(
      and(eq(schema.workspaceDomain.organizationId, organizationId), eq(schema.workspaceDomain.status, "verified")),
    )
    .orderBy(asc(schema.workspaceDomain.createdAt))
    .limit(1);
  if (domain) return `${env().APP_PROTOCOL}://${domain.hostname}`;
  return env().BETTER_AUTH_URL.replace(/\/+$/, "");
}

/**
 * One-click unsubscribe (no sign-in): suppress the contact's email in its workspace, stop every
 * enrollment and hold back unsent messages. Returns null for unknown or forged tokens.
 */
export async function unsubscribe(
  token: string,
): Promise<{ organizationId: string; email: string | null; brandName: string } | null> {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return null;
  const [org] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, parsed.organizationId))
    .limit(1);
  if (!org) return null;
  const brand = await workspaceBrand(org.id);
  const [contact] = await db
    .select({ id: schema.contact.id, email: schema.contact.email })
    .from(schema.contact)
    .where(and(eq(schema.contact.id, parsed.contactId), eq(schema.contact.organizationId, org.id)))
    .limit(1);
  if (!contact) return { organizationId: org.id, email: null, brandName: brand.name };

  await db.transaction(async (tx) => {
    if (contact.email) {
      await tx
        .insert(schema.suppression)
        .values({
          organizationId: org.id,
          kind: "email",
          value: contact.email.toLowerCase(),
          reason: "unsubscribed",
          note: "One-click unsubscribe link",
        })
        .onConflictDoNothing();
    }
    const stopped = await tx
      .update(schema.enrollment)
      .set({ status: "unsubscribed", nextRunAt: null })
      .where(
        and(
          eq(schema.enrollment.organizationId, org.id),
          eq(schema.enrollment.contactId, contact.id),
          inArray(schema.enrollment.status, ["active", "paused", "replied"]),
        ),
      )
      .returning({ id: schema.enrollment.id });
    await tx
      .update(schema.outboundMessage)
      .set({ status: "blocked", blockedReason: "The contact unsubscribed." })
      .where(
        and(
          eq(schema.outboundMessage.organizationId, org.id),
          eq(schema.outboundMessage.contactId, contact.id),
          inArray(schema.outboundMessage.status, ["pending_review", "queued", "failed"]),
        ),
      );
    await tx.insert(schema.auditLog).values({
      organizationId: org.id,
      action: "suppression.unsubscribe",
      entityType: "contact",
      entityId: contact.id,
      metadata: { enrollmentsStopped: stopped.length },
    });
  });
  return { organizationId: org.id, email: contact.email, brandName: brand.name };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export const MERGE_FIELDS = ["first_name", "last_name", "company", "title"] as const;
type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Record<MergeField, string | null>;

/** Replace {{field}} tokens. Unknown or empty fields are reported, never rendered blank. */
export function renderTemplate(template: string, values: MergeValues): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (token, raw: string) => {
    const name = raw.toLowerCase();
    if (!(MERGE_FIELDS as readonly string[]).includes(name)) {
      missing.add(name);
      return token;
    }
    const value = values[name as MergeField]?.trim();
    if (!value) {
      missing.add(name);
      return token;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

function footer(mailbox: MailboxRow, unsubscribeUrl: string): string {
  return [
    "",
    "--",
    mailbox.displayName ? `${mailbox.displayName} <${mailbox.email}>` : mailbox.email,
    mailbox.postalAddress ?? "",
    "",
    `To stop receiving these emails, unsubscribe here: ${unsubscribeUrl}`,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Checks at send time                                                        */
/* -------------------------------------------------------------------------- */

async function blockReason(organizationId: string, contact: ContactRow | undefined, toEmail: string | null) {
  if (!contact) return "The contact was deleted.";
  if (!toEmail) return "The contact has no email address.";
  const hit = (await suppressionsFor(organizationId, [toEmail])).get(toEmail.toLowerCase());
  if (hit) return hit.kind === "email" ? `Suppressed email (${hit.reason}).` : `Suppressed domain (${hit.reason}).`;
  if (contact.emailStatus === "invalid") return "The email address is invalid.";
  if (contact.emailStatus === "disposable") return "The email address is disposable.";
  if (contact.stage === "do_not_contact") return "The contact's stage is do not contact.";
  return null;
}

/** Enrollment status after a blocked step: suppression stops it for good, anything else pauses it. */
function statusAfterBlock(reason: string): EnrollmentRow["status"] {
  if (reason.includes("(unsubscribed)")) return "unsubscribed";
  if (reason.includes("(bounced)")) return "bounced";
  return "paused";
}

const runnableStatuses = (seq: Pick<SequenceRow, "stopOnReply">): EnrollmentRow["status"][] =>
  seq.stopOnReply ? ["active"] : ["active", "replied"];

/* -------------------------------------------------------------------------- */
/* Enrollment progress                                                        */
/* -------------------------------------------------------------------------- */

/** Move to the next step (or finish). Conditional on the current step so a step is never advanced twice. */
async function advance(enrollment: EnrollmentRow, steps: StepRow[], now = new Date()): Promise<boolean> {
  const nextIndex = enrollment.currentStep + 1;
  const next = steps[nextIndex];
  const rows = await db
    .update(schema.enrollment)
    .set(
      next
        ? { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + next.waitDays * DAY_MS) }
        : { currentStep: nextIndex, status: "finished", nextRunAt: null },
    )
    .where(and(eq(schema.enrollment.id, enrollment.id), eq(schema.enrollment.currentStep, enrollment.currentStep)))
    .returning({ id: schema.enrollment.id });
  return rows.length > 0;
}

async function hold(enrollmentId: string, status?: EnrollmentRow["status"]) {
  await db
    .update(schema.enrollment)
    .set(status ? { nextRunAt: null, status } : { nextRunAt: null })
    .where(eq(schema.enrollment.id, enrollmentId));
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

interface DeliveryContext {
  sequence: SequenceRow;
  mailbox: MailboxRow;
  steps: StepRow[];
}

type DeliveryOutcome = "sent" | "failed" | "blocked";

/** Send one queued message through the mailbox, re-checking compliance first, then advance the enrollment. */
async function deliver(message: MessageRow, ctx: DeliveryContext): Promise<DeliveryOutcome> {
  const [enrollment] = message.enrollmentId
    ? await db.select().from(schema.enrollment).where(eq(schema.enrollment.id, message.enrollmentId)).limit(1)
    : [];
  const [contact] = message.contactId
    ? await db.select().from(schema.contact).where(eq(schema.contact.id, message.contactId)).limit(1)
    : [];

  let reason = await blockReason(message.organizationId, contact, message.toEmail);
  if (!reason && enrollment && !runnableStatuses(ctx.sequence).includes(enrollment.status)) {
    reason = `The enrollment is ${enrollment.status}.`;
  }
  if (reason) {
    await db
      .update(schema.outboundMessage)
      .set({ status: "blocked", blockedReason: reason })
      .where(eq(schema.outboundMessage.id, message.id));
    if (enrollment && runnableStatuses(ctx.sequence).includes(enrollment.status)) {
      await hold(enrollment.id, statusAfterBlock(reason));
    }
    return "blocked";
  }

  // Claim the message so a concurrent sender can't pick it up as well.
  const claimed = await db
    .update(schema.outboundMessage)
    .set({ scheduledAt: new Date(), error: null })
    .where(
      and(
        eq(schema.outboundMessage.id, message.id),
        inArray(schema.outboundMessage.status, ["queued", "failed", "pending_review"]),
      ),
    )
    .returning({ id: schema.outboundMessage.id });
  if (!claimed.length) return "blocked";

  const transport = mailboxTransport(ctx.mailbox);
  if (!transport) {
    await db
      .update(schema.outboundMessage)
      .set({ status: "failed", error: "The mailbox has no SMTP settings." })
      .where(eq(schema.outboundMessage.id, message.id));
    return "failed";
  }
  const origin = await workspaceOrigin(message.organizationId);
  const unsubscribeUrl = `${origin}/u/${unsubscribeToken(message.organizationId, message.contactId ?? "")}`;
  try {
    const info = await transport.sendMail({
      from: ctx.mailbox.displayName ? { name: ctx.mailbox.displayName, address: ctx.mailbox.email } : ctx.mailbox.email,
      to: message.toEmail,
      subject: message.subject,
      text: message.body,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    const sentAt = new Date();
    await db
      .update(schema.outboundMessage)
      .set({ status: "sent", sentAt, providerMessageId: info.messageId ?? null, error: null })
      .where(eq(schema.outboundMessage.id, message.id));
    if (contact) {
      await db
        .update(schema.contact)
        .set({ stage: "contacted" })
        .where(and(eq(schema.contact.id, contact.id), eq(schema.contact.stage, "new")));
    }
    if (enrollment) await advance(enrollment, ctx.steps, sentAt);
    return "sent";
  } catch (error) {
    const plain = smtpErrorMessage(error, ctx.mailbox);
    logger.warn("message send failed", {
      messageId: message.id,
      mailboxId: ctx.mailbox.id,
      code: (error as { code?: string }).code,
    });
    await db
      .update(schema.outboundMessage)
      .set({ status: "failed", error: plain })
      .where(eq(schema.outboundMessage.id, message.id));
    if (enrollment) await hold(enrollment.id);
    return "failed";
  } finally {
    transport.close();
  }
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

export interface RunResult {
  sequenceId: string;
  ran: boolean;
  note?: string;
  sent: number;
  failed: number;
  blocked: number;
  pendingReview: number;
  tasks: number;
  finished: number;
  /** Due emails left for later because the mailbox reached its daily limit. */
  limited: number;
  /** Due emails left for later because it's outside the mailbox's sending window. */
  outsideWindow: number;
}

const LOCK_TTL_SECONDS = 300;

/** Redis lock so two schedulers (or a scheduler and "run now") never process one sequence at once. */
async function withSequenceLock<T>(sequenceId: string, fn: () => Promise<T>): Promise<T | "locked"> {
  const client = redis();
  if (!client) return fn();
  const key = `anhour:lock:sequence:${sequenceId}`;
  const value = randomUUID();
  let acquired: string | null;
  try {
    acquired = await client.set(key, value, "EX", LOCK_TTL_SECONDS, "NX");
  } catch (error) {
    logger.warn("sequence lock unavailable", { sequenceId, error });
    return "locked";
  }
  if (acquired !== "OK") return "locked";
  try {
    return await fn();
  } finally {
    try {
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        value,
      );
    } catch {
      // The lock expires on its own.
    }
  }
}

const TASK_TYPE: Record<Exclude<StepRow["type"], "auto_email">, (typeof schema.task.$inferInsert)["type"]> = {
  call: "call",
  manual_email: "email",
  task: "action_item",
};

const TASK_VERB: Record<Exclude<StepRow["type"], "auto_email">, string> = {
  call: "Call",
  manual_email: "Email",
  task: "Follow up with",
};

function contactName(c: Pick<ContactRow, "firstName" | "lastName" | "email">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "contact";
}

async function mergeValues(contact: ContactRow): Promise<MergeValues> {
  let company: string | null = null;
  if (contact.companyId) {
    const [row] = await db
      .select({ name: schema.company.name })
      .from(schema.company)
      .where(eq(schema.company.id, contact.companyId))
      .limit(1);
    company = row?.name ?? null;
  }
  return { first_name: contact.firstName, last_name: contact.lastName, company, title: contact.title };
}

/** One pass over a single sequence. Safe to call repeatedly: every step happens at most once. */
export async function runSequence(sequenceId: string, now = new Date()): Promise<RunResult> {
  const result: RunResult = {
    sequenceId,
    ran: false,
    sent: 0,
    failed: 0,
    blocked: 0,
    pendingReview: 0,
    tasks: 0,
    finished: 0,
    limited: 0,
    outsideWindow: 0,
  };
  const locked = await withSequenceLock(sequenceId, async () => {
    const [sequence] = await db.select().from(schema.sequence).where(eq(schema.sequence.id, sequenceId)).limit(1);
    if (sequence?.status !== "active") {
      result.note = "The sequence isn't active.";
      return;
    }
    const [mailbox] = sequence.mailboxId
      ? await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, sequence.mailboxId)).limit(1)
      : [];
    if (!mailbox) {
      result.note = "The sequence has no mailbox.";
      return;
    }
    const issues = mailboxIssues(mailbox);
    if (issues.length) {
      result.note = issues[0];
      return;
    }
    result.ran = true;
    const steps = await db
      .select()
      .from(schema.sequenceStep)
      .where(eq(schema.sequenceStep.sequenceId, sequence.id))
      .orderBy(asc(schema.sequenceStep.position), asc(schema.sequenceStep.createdAt));
    const ctx: DeliveryContext = { sequence, mailbox, steps };
    const inWindow = inSendingWindow(mailbox.sendingWindowStart, mailbox.sendingWindowEnd, mailbox.timezone, now);
    let sentToday = await sentTodayCount(mailbox, now);
    const origin = await workspaceOrigin(sequence.organizationId);
    const canSend = () => mailbox.status !== "paused" && sentToday < mailbox.dailyLimit;

    const tally = (outcome: DeliveryOutcome) => {
      if (outcome === "sent") {
        result.sent++;
        sentToday++;
      } else if (outcome === "failed") result.failed++;
      else result.blocked++;
    };

    // 1. Approved messages waiting to go out.
    const queued = await db
      .select({ message: schema.outboundMessage })
      .from(schema.outboundMessage)
      .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
      .where(and(eq(schema.enrollment.sequenceId, sequence.id), eq(schema.outboundMessage.status, "queued")))
      .orderBy(asc(schema.outboundMessage.createdAt))
      .limit(BATCH);
    for (const { message } of queued) {
      if (!inWindow) {
        result.outsideWindow++;
        continue;
      }
      if (!canSend()) {
        result.limited++;
        continue;
      }
      tally(await deliver(message, ctx));
    }

    // 2. Enrollments whose next step is due.
    const due = await db
      .select({ enrollment: schema.enrollment, contact: schema.contact })
      .from(schema.enrollment)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
      .where(
        and(
          eq(schema.enrollment.sequenceId, sequence.id),
          inArray(schema.enrollment.status, runnableStatuses(sequence)),
          isNotNull(schema.enrollment.nextRunAt),
          lte(schema.enrollment.nextRunAt, now),
        ),
      )
      .orderBy(asc(schema.enrollment.nextRunAt), asc(schema.enrollment.id))
      .limit(BATCH);

    for (const { enrollment, contact } of due) {
      const step = steps[enrollment.currentStep];
      if (!step) {
        await db
          .update(schema.enrollment)
          .set({ status: "finished", nextRunAt: null })
          .where(eq(schema.enrollment.id, enrollment.id));
        result.finished++;
        continue;
      }

      // Idempotency: a message already exists for this step (a crash after sending, or one under review).
      const [existing] = await db
        .select()
        .from(schema.outboundMessage)
        .where(and(eq(schema.outboundMessage.enrollmentId, enrollment.id), eq(schema.outboundMessage.stepId, step.id)))
        .orderBy(desc(schema.outboundMessage.createdAt))
        .limit(1);
      if (existing?.status === "sent") {
        await advance(enrollment, steps, now);
        continue;
      }
      if (existing && existing.status !== "blocked") {
        await hold(enrollment.id);
        continue;
      }

      if (step.type !== "auto_email") {
        const values = await mergeValues(contact);
        const note = step.body ? renderTemplate(step.body, values).text : null;
        const label = `${TASK_VERB[step.type]} ${contactName(contact)}`;
        const moved = await advance(enrollment, steps, now);
        if (moved) {
          await db.insert(schema.task).values({
            organizationId: sequence.organizationId,
            assigneeId: enrollment.enrolledById ?? contact.ownerId,
            contactId: contact.id,
            companyId: contact.companyId,
            type: TASK_TYPE[step.type],
            title: `${label} (${sequence.name}, step ${enrollment.currentStep + 1})`.slice(0, 200),
            note: step.type === "manual_email" && step.subject ? `Subject: ${step.subject}\n\n${note ?? ""}` : note,
            dueAt: now,
          });
          result.tasks++;
        }
        continue;
      }

      const values = await mergeValues(contact);
      const subject = renderTemplate(step.subject ?? "", values);
      const body = renderTemplate(step.body ?? "", values);
      const missing = [...new Set([...subject.missing, ...body.missing])];
      const toEmail = contact.email ?? "";
      const fullBody = `${body.text}\n${footer(mailbox, `${origin}/u/${unsubscribeToken(sequence.organizationId, contact.id)}`)}`;
      const base = {
        organizationId: sequence.organizationId,
        mailboxId: mailbox.id,
        contactId: contact.id,
        enrollmentId: enrollment.id,
        stepId: step.id,
        toEmail: toEmail || "(no email)",
        subject: subject.text.slice(0, 998) || "(no subject)",
        body: fullBody,
      };

      const reason =
        (await blockReason(sequence.organizationId, contact, contact.email)) ??
        (missing.length ? `Missing merge field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` : null);
      if (reason) {
        await db.insert(schema.outboundMessage).values({ ...base, status: "blocked", blockedReason: reason });
        await hold(enrollment.id, statusAfterBlock(reason));
        result.blocked++;
        continue;
      }

      const needsReview =
        sequence.reviewMode === "all" || (sequence.reviewMode === "first_step" && enrollment.currentStep === 0);
      if (needsReview) {
        await db.insert(schema.outboundMessage).values({ ...base, status: "pending_review" });
        await hold(enrollment.id);
        result.pendingReview++;
        continue;
      }

      if (!inWindow) {
        result.outsideWindow++;
        continue;
      }
      if (!canSend()) {
        result.limited++;
        continue;
      }
      const [message] = await db
        .insert(schema.outboundMessage)
        .values({ ...base, status: "queued", scheduledAt: now })
        .returning();
      tally(await deliver(message, ctx));
    }
  });
  if (locked === "locked") result.note = "Another run is processing this sequence. Try again shortly.";
  return result;
}

/** Scheduler entry point: one pass over every active sequence. */
export async function runDueSequences(): Promise<{ processed: number; note?: string }> {
  const active = await db
    .select({ id: schema.sequence.id })
    .from(schema.sequence)
    .where(eq(schema.sequence.status, "active"));
  let processed = 0;
  for (const { id } of active) {
    try {
      const r = await runSequence(id);
      processed += r.sent + r.blocked + r.pendingReview + r.tasks + r.failed + r.finished;
    } catch (error) {
      logger.error("sequence run failed", { sequenceId: id, error });
    }
  }
  return { processed, note: `${active.length} active sequence${active.length === 1 ? "" : "s"}` };
}

/* -------------------------------------------------------------------------- */
/* Outbound review                                                            */
/* -------------------------------------------------------------------------- */

export const messageSearchSchema = z.object({
  status: z.enum(schema.outboundMessage.status.enumValues).optional(),
  sequenceId: z.string().min(1).max(100).optional(),
});

export interface MessageView {
  id: string;
  status: MessageRow["status"];
  toEmail: string;
  subject: string;
  body: string;
  blockedReason: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  mailbox: { id: string; email: string } | null;
  contact: { id: string; name: string } | null;
  sequence: { id: string; name: string } | null;
  stepPosition: number | null;
}

export async function searchMessages(
  actor: Actor,
  input: unknown,
  page: Page,
  messageId?: string,
): Promise<{ messages: MessageView[]; total: number }> {
  const filters = messageSearchSchema.parse(input ?? {});
  const where: SQL[] = [eq(schema.outboundMessage.organizationId, actor.organizationId)];
  if (messageId) where.push(eq(schema.outboundMessage.id, messageId));
  if (filters.status) where.push(eq(schema.outboundMessage.status, filters.status));
  if (filters.sequenceId) where.push(eq(schema.enrollment.sequenceId, filters.sequenceId));
  const [total] = await db
    .select({ n: count() })
    .from(schema.outboundMessage)
    .leftJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(and(...where));
  const rows = await db
    .select({
      message: schema.outboundMessage,
      mailboxEmail: schema.mailbox.email,
      firstName: schema.contact.firstName,
      lastName: schema.contact.lastName,
      contactEmail: schema.contact.email,
      sequenceId: schema.sequence.id,
      sequenceName: schema.sequence.name,
      stepPosition: schema.sequenceStep.position,
    })
    .from(schema.outboundMessage)
    .leftJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .leftJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
    .leftJoin(schema.mailbox, eq(schema.mailbox.id, schema.outboundMessage.mailboxId))
    .leftJoin(schema.contact, eq(schema.contact.id, schema.outboundMessage.contactId))
    .leftJoin(schema.sequenceStep, eq(schema.sequenceStep.id, schema.outboundMessage.stepId))
    .where(and(...where))
    .orderBy(desc(schema.outboundMessage.createdAt), asc(schema.outboundMessage.id))
    .limit(page.perPage)
    .offset(page.offset);
  return {
    total: total?.n ?? 0,
    messages: rows.map((r) => ({
      id: r.message.id,
      status: r.message.status,
      toEmail: r.message.toEmail,
      subject: r.message.subject,
      body: r.message.body,
      blockedReason: r.message.blockedReason,
      error: r.message.error,
      sentAt: r.message.sentAt?.toISOString() ?? null,
      createdAt: r.message.createdAt.toISOString(),
      mailbox: r.message.mailboxId && r.mailboxEmail ? { id: r.message.mailboxId, email: r.mailboxEmail } : null,
      contact: r.message.contactId
        ? {
            id: r.message.contactId,
            name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.contactEmail || r.message.toEmail,
          }
        : null,
      sequence: r.sequenceId && r.sequenceName ? { id: r.sequenceId, name: r.sequenceName } : null,
      stepPosition: r.stepPosition ?? null,
    })),
  };
}

async function findMessage(actor: Actor, id: string) {
  const [row] = await db
    .select({ message: schema.outboundMessage, sequence: schema.sequence })
    .from(schema.outboundMessage)
    .leftJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .leftJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
    .where(and(eq(schema.outboundMessage.id, id), eq(schema.outboundMessage.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("Message not found.");
  return row;
}

async function messageView(actor: Actor, id: string): Promise<MessageView> {
  const { messages } = await searchMessages(actor, {}, { page: 1, perPage: 1, offset: 0 }, id);
  const [view] = messages;
  if (!view) throw notFound("Message not found.");
  return view;
}

/** Approve a message held for review. The engine sends it on its next pass, inside the mailbox's window. */
export async function approveMessage(actor: Actor, id: string): Promise<{ message: MessageView }> {
  const { message } = await findMessage(actor, id);
  if (message.status !== "pending_review") {
    throw new HttpError(422, "Only messages waiting for review can be approved.");
  }
  await db
    .update(schema.outboundMessage)
    .set({ status: "queued" })
    .where(and(eq(schema.outboundMessage.id, message.id), eq(schema.outboundMessage.status, "pending_review")));
  await audit(actor, "message.approve", "outbound_message", message.id);
  return { message: await messageView(actor, message.id) };
}

/**
 * Send now, ignoring the sending window (a person chose to send it). Compliance checks and the
 * mailbox's daily limit still apply.
 */
export async function sendMessageNow(actor: Actor, id: string): Promise<{ message: MessageView }> {
  const { message, sequence } = await findMessage(actor, id);
  if (!["pending_review", "queued", "failed"].includes(message.status)) {
    throw new HttpError(422, "This message can't be sent. Only messages under review, queued or failed can.");
  }
  if (!sequence) throw new HttpError(422, "This message isn't part of a sequence.");
  if (sequence.status !== "active") throw new HttpError(422, "Activate the sequence before sending its messages.");
  const [mailbox] = message.mailboxId
    ? await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, message.mailboxId)).limit(1)
    : [];
  if (!mailbox) throw new HttpError(422, "The mailbox for this message was removed.");
  const issues = mailboxIssues(mailbox);
  if (issues.length) throw new HttpError(422, issues[0]);
  if ((await sentTodayCount(mailbox)) >= mailbox.dailyLimit) {
    throw new HttpError(422, "This mailbox reached its daily limit. It will send again tomorrow.");
  }
  const steps = await db
    .select()
    .from(schema.sequenceStep)
    .where(eq(schema.sequenceStep.sequenceId, sequence.id))
    .orderBy(asc(schema.sequenceStep.position), asc(schema.sequenceStep.createdAt));
  const outcome = await withSequenceLock(sequence.id, () => deliver(message, { sequence, mailbox, steps }));
  if (outcome === "locked") throw new HttpError(409, "This sequence is sending right now. Try again shortly.");
  await audit(actor, "message.send_now", "outbound_message", message.id, { outcome });
  return { message: await messageView(actor, message.id) };
}
