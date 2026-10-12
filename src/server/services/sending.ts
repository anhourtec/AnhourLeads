import "server-only";

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

import { DEFAULT_RULESET, type MergeField, type Ruleset } from "@/lib/engage-constants";
import { AUTO_PAUSE_AUDIT_ACTION, POLICY_BLOCK_REASONS } from "@/lib/sending-policy";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { log } from "@/server/log";
import { redis } from "@/server/redis";
import { workspaceBrand } from "@/server/tenancy/brand";

import { emitEvent as recordEvent } from "./engage-events";
import {
  inSendingWindow,
  type MailboxRow,
  mailboxIssues,
  mailboxTransport,
  sentTodayCount,
  smtpErrorMessage,
} from "./mailboxes";
import { notify } from "./notifications";
import { inSchedule } from "./schedules";
import {
  BOUNCE_GUARD_MIN_SAMPLE,
  BOUNCE_GUARD_WINDOW,
  policyHoldReason,
  rampLimit,
  type SendingPolicy,
  sendingPolicyFor,
} from "./sending-guards";
import { openPixelUrl, trackedLinkUrl } from "./tracking-tokens";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const logger = log.child({ component: "sending" });

type SequenceRow = typeof schema.sequence.$inferSelect;
type StepRow = typeof schema.sequenceStep.$inferSelect;
type VariantRow = typeof schema.stepVariant.$inferSelect;
type EnrollmentRow = typeof schema.enrollment.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;
type CompanyRow = typeof schema.company.$inferSelect;
export type MessageRow = typeof schema.outboundMessage.$inferSelect;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
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
  // Installation-wide opt-outs (public removal requests) apply to every workspace.
  const remaining = lower.filter((email) => !map.has(email));
  if (remaining.length) {
    const optouts = await db
      .select({ kind: schema.indexOptout.kind, value: schema.indexOptout.value })
      .from(schema.indexOptout)
      .where(
        or(
          and(eq(schema.indexOptout.kind, "email"), inArray(sql`lower(${schema.indexOptout.value})`, remaining)),
          and(
            eq(schema.indexOptout.kind, "domain"),
            inArray(sql`lower(${schema.indexOptout.value})`, [...new Set(remaining.map(domainOf).filter(Boolean))]),
          ),
        ),
      );
    for (const email of remaining) {
      const hit = optouts.find((o) =>
        o.kind === "email" ? o.value.toLowerCase() === email : o.value.toLowerCase() === domainOf(email),
      );
      if (hit) map.set(email, { kind: hit.kind === "email" ? "email" : "domain", reason: "erasure_request" });
    }
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
    .select({ id: schema.contact.id, email: schema.contact.email, companyId: schema.contact.companyId })
    .from(schema.contact)
    .where(and(eq(schema.contact.id, parsed.contactId), eq(schema.contact.organizationId, org.id)))
    .limit(1);
  if (!contact) return { organizationId: org.id, email: null, brandName: brand.name };

  const stopped = await db.transaction(async (tx) => {
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
    const rows = await tx
      .update(schema.enrollment)
      .set({ status: "unsubscribed", nextRunAt: null })
      .where(
        and(
          eq(schema.enrollment.organizationId, org.id),
          eq(schema.enrollment.contactId, contact.id),
          inArray(schema.enrollment.status, ["active", "paused", "replied"]),
        ),
      )
      .returning({ id: schema.enrollment.id, sequenceId: schema.enrollment.sequenceId });
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
      metadata: { enrollmentsStopped: rows.length },
    });
    return rows;
  });
  await recordEvent({
    organizationId: org.id,
    type: "email_unsubscribed",
    summary: "Unsubscribed with the one-click link",
    contactId: contact.id,
    companyId: contact.companyId,
    metadata: { sequenceIds: stopped.map((r) => r.sequenceId) },
  });
  return { organizationId: org.id, email: contact.email, brandName: brand.name };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export type MergeValues = Record<MergeField, string | null>;
const MERGE_NAMES = new Set<string>([
  "first_name",
  "last_name",
  "full_name",
  "email",
  "title",
  "company",
  "company_domain",
  "city",
  "country",
]);

/** Replace {{field}} tokens. Unknown or empty fields are reported, never rendered blank. */
export function renderTemplate(template: string, values: MergeValues): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (token, raw: string) => {
    const name = raw.toLowerCase();
    if (!MERGE_NAMES.has(name)) {
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

export function mergeValuesFor(contact: ContactRow, company: Pick<CompanyRow, "name" | "domain"> | null): MergeValues {
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return {
    first_name: contact.firstName,
    last_name: contact.lastName,
    full_name: fullName || null,
    email: contact.email,
    title: contact.title,
    company: company?.name ?? null,
    company_domain: company?.domain ?? null,
    city: contact.city,
    country: contact.country,
  };
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

/** Body as sent: the text, the mailbox signature when there is one, then the compliance footer. */
export function composeBody(text: string, mailbox: MailboxRow, unsubscribeUrl: string): string {
  const signature = mailbox.signature?.trim();
  return `${text}${signature ? `\n\n${signature}` : ""}\n${footer(mailbox, unsubscribeUrl)}`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** HTML alternative used only when open or click tracking is on: the same text, links wrapped, a pixel. */
function trackedHtml(text: string, opts: { origin: string; messageId: string; opens: boolean; clicks: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  const html = parts
    .map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part);
      const isUnsubscribe = part.includes("/u/");
      const href = opts.clicks && !isUnsubscribe ? trackedLinkUrl(opts.origin, opts.messageId, part) : part;
      return `<a href="${escapeHtml(href)}">${escapeHtml(part)}</a>`;
    })
    .join("");
  const pixel = opts.opens
    ? `<img src="${escapeHtml(openPixelUrl(opts.origin, opts.messageId))}" width="1" height="1" alt="" style="display:none">`
    : "";
  return `<div style="white-space:pre-wrap;font-family:sans-serif">${html}</div>${pixel}`;
}

/* -------------------------------------------------------------------------- */
/* Rulesets                                                                   */
/* -------------------------------------------------------------------------- */

/** A sequence's stored ruleset merged over the defaults (old rows store `{}`). */
export function rulesetOf(sequence: Pick<SequenceRow, "ruleset">): Ruleset {
  const raw = (sequence.ruleset ?? {}) as Partial<Ruleset>;
  return {
    ...DEFAULT_RULESET,
    ...raw,
    openCallTask: { ...DEFAULT_RULESET.openCallTask, ...(raw.openCallTask ?? {}) },
  };
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

/** Ruleset email triggers: the contact's or account's stage marks the email "Not sent". */
function notSentReason(ruleset: Ruleset, contact: ContactRow, company: CompanyRow | null): string | null {
  if ((ruleset.notSentContactStages as string[]).includes(contact.stage)) {
    return `Not sent: the contact's stage is ${contact.stage.replace(/_/g, " ")}.`;
  }
  if (company && (ruleset.notSentAccountStages as string[]).includes(company.stage)) {
    return `Not sent: the account's stage is ${company.stage}.`;
  }
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

export const stepDelayMs = (step: Pick<StepRow, "waitDays" | "waitMinutes">) =>
  step.waitDays * DAY_MS + step.waitMinutes * MINUTE_MS;

/** Index of the first enabled step at or after `from`, or -1. */
export function nextEnabledIndex(steps: Pick<StepRow, "enabled">[], from: number): number {
  for (let i = Math.max(0, from); i < steps.length; i++) if (steps[i].enabled) return i;
  return -1;
}

/** Move to the next enabled step (or finish). Conditional on the current step so a step is never advanced twice. */
async function advance(
  enrollment: EnrollmentRow,
  steps: StepRow[],
  sequence: Pick<SequenceRow, "id" | "name" | "organizationId">,
  contact: Pick<ContactRow, "id" | "companyId">,
  now = new Date(),
): Promise<boolean> {
  const nextIndex = nextEnabledIndex(steps, enrollment.currentStep + 1);
  const next = nextIndex >= 0 ? steps[nextIndex] : undefined;
  const rows = await db
    .update(schema.enrollment)
    .set(
      next
        ? { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + stepDelayMs(next)) }
        : { currentStep: steps.length, status: "finished", nextRunAt: null },
    )
    .where(and(eq(schema.enrollment.id, enrollment.id), eq(schema.enrollment.currentStep, enrollment.currentStep)))
    .returning({ id: schema.enrollment.id });
  if (!rows.length) return false;
  const base = {
    organizationId: sequence.organizationId,
    contactId: contact.id,
    companyId: contact.companyId,
    metadata: { sequenceId: sequence.id, enrollmentId: enrollment.id, step: enrollment.currentStep + 1 },
  };
  await recordEvent({
    ...base,
    type: "contact_finished_step",
    summary: `Finished step ${enrollment.currentStep + 1} of ${sequence.name}`,
  });
  if (!next) {
    await recordEvent({
      ...base,
      type: "contact_finished_sequence",
      summary: `Finished the sequence ${sequence.name}`,
    });
  }
  return true;
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

export interface DeliveryContext {
  /** Null for one-off emails from the composer. */
  sequence: SequenceRow | null;
  mailbox: MailboxRow;
  steps: StepRow[];
}

type DeliveryOutcome = "sent" | "failed" | "blocked" | "bounced";

const splitAddresses = (value: string | null | undefined) =>
  (value ?? "")
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/** A permanent recipient rejection from the receiving server: treat as a hard bounce. */
function isHardBounce(error: unknown): boolean {
  const e = (typeof error === "object" && error !== null ? error : {}) as { responseCode?: number; command?: string };
  return Boolean(e.responseCode && e.responseCode >= 550 && e.responseCode <= 553 && e.command === "RCPT TO");
}

/** Threading headers for a reply-in-thread step: the enrollment's earlier sent messages. */
async function threadHeaders(message: MessageRow, step: StepRow | undefined) {
  if (!message.enrollmentId || step?.threadMode !== "reply") return {};
  const earlier = await db
    .select({ providerMessageId: schema.outboundMessage.providerMessageId })
    .from(schema.outboundMessage)
    .where(
      and(
        eq(schema.outboundMessage.enrollmentId, message.enrollmentId),
        eq(schema.outboundMessage.status, "sent"),
        isNotNull(schema.outboundMessage.providerMessageId),
        ne(schema.outboundMessage.id, message.id),
      ),
    )
    .orderBy(asc(schema.outboundMessage.sentAt));
  const ids = earlier.map((r) => r.providerMessageId).filter((v): v is string => Boolean(v));
  if (!ids.length) return {};
  return { inReplyTo: ids[ids.length - 1], references: ids };
}

/** Send one queued message through the mailbox, re-checking compliance first, then advance the enrollment. */
export async function deliver(message: MessageRow, ctx: DeliveryContext): Promise<DeliveryOutcome> {
  const [enrollment] = message.enrollmentId
    ? await db.select().from(schema.enrollment).where(eq(schema.enrollment.id, message.enrollmentId)).limit(1)
    : [];
  const [contact] = message.contactId
    ? await db.select().from(schema.contact).where(eq(schema.contact.id, message.contactId)).limit(1)
    : [];
  const policy = await sendingPolicyFor(message.organizationId);

  let reason = message.contactId
    ? await blockReason(message.organizationId, contact, message.toEmail)
    : await oneOffBlockReason(message.organizationId, message.toEmail);
  if (!reason && contact) reason = policyHoldReason(policy, contact.emailStatus);
  if (!reason && policy.requireSignature && !ctx.mailbox.signature?.trim()) {
    reason = POLICY_BLOCK_REASONS.signature;
  }
  if (!reason && ctx.sequence && enrollment && !runnableStatuses(ctx.sequence).includes(enrollment.status)) {
    reason = `The enrollment is ${enrollment.status}.`;
  }
  if (reason) {
    await db
      .update(schema.outboundMessage)
      .set({ status: "blocked", blockedReason: reason })
      .where(eq(schema.outboundMessage.id, message.id));
    if (ctx.sequence && enrollment && runnableStatuses(ctx.sequence).includes(enrollment.status)) {
      await hold(enrollment.id, statusAfterBlock(reason));
    }
    await recordEvent({
      organizationId: message.organizationId,
      type: "email_not_sent",
      summary: `Email not sent: ${reason}`,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      metadata: eventMeta(message, ctx),
    });
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
  const step = message.stepId ? ctx.steps.find((s) => s.id === message.stepId) : undefined;
  const tracking = ctx.sequence && (ctx.sequence.trackOpens || ctx.sequence.trackClicks);
  try {
    const info = await transport.sendMail({
      from: ctx.mailbox.displayName ? { name: ctx.mailbox.displayName, address: ctx.mailbox.email } : ctx.mailbox.email,
      to: message.toEmail,
      cc: ctx.sequence ? splitAddresses(ctx.sequence.cc) : undefined,
      bcc: ctx.sequence ? splitAddresses(ctx.sequence.bcc) : undefined,
      subject: message.subject,
      text: message.body,
      html:
        tracking && ctx.sequence
          ? trackedHtml(message.body, {
              origin,
              messageId: message.id,
              opens: ctx.sequence.trackOpens,
              clicks: ctx.sequence.trackClicks,
            })
          : undefined,
      ...(await threadHeaders(message, step)),
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
        .set({ stage: "contacted", lastActivityAt: sentAt })
        .where(and(eq(schema.contact.id, contact.id), eq(schema.contact.stage, "new")));
    }
    await recordEvent({
      organizationId: message.organizationId,
      type: "email_sent",
      summary: `Email sent: ${message.subject}`,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      metadata: eventMeta(message, ctx),
    });
    if (enrollment && contact && ctx.sequence) await advance(enrollment, ctx.steps, ctx.sequence, contact, sentAt);
    return "sent";
  } catch (error) {
    const plain = smtpErrorMessage(error, ctx.mailbox);
    logger.warn("message send failed", {
      messageId: message.id,
      mailboxId: ctx.mailbox.id,
      code: (error as { code?: string }).code,
    });
    if (isHardBounce(error)) {
      await db
        .update(schema.outboundMessage)
        .set({ status: "bounced", error: plain })
        .where(eq(schema.outboundMessage.id, message.id));
      if (enrollment) await hold(enrollment.id, "bounced");
      await db
        .insert(schema.suppression)
        .values({
          organizationId: message.organizationId,
          kind: "email",
          value: message.toEmail.toLowerCase(),
          reason: "bounced",
          note: "Hard bounce while sending",
        })
        .onConflictDoNothing();
      await recordEvent({
        organizationId: message.organizationId,
        type: "email_bounced",
        summary: `Email bounced: ${message.subject}`,
        contactId: contact?.id ?? null,
        companyId: contact?.companyId ?? null,
        metadata: eventMeta(message, ctx),
      });
      return "bounced";
    }
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

function eventMeta(message: MessageRow, ctx: DeliveryContext): Record<string, unknown> {
  return {
    messageId: message.id,
    mailboxId: ctx.mailbox.id,
    sequenceId: ctx.sequence?.id ?? null,
    enrollmentId: message.enrollmentId,
    stepId: message.stepId,
    variantId: message.variantId,
  };
}

/** Compliance for one-off emails to an address without a contact record: suppression only. */
async function oneOffBlockReason(organizationId: string, toEmail: string): Promise<string | null> {
  const hit = (await suppressionsFor(organizationId, [toEmail])).get(toEmail.toLowerCase());
  if (hit) return hit.kind === "email" ? `Suppressed email (${hit.reason}).` : `Suppressed domain (${hit.reason}).`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Counters                                                                   */
/* -------------------------------------------------------------------------- */

async function sequenceSentSince(sequenceId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.outboundMessage)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(
      and(
        eq(schema.enrollment.sequenceId, sequenceId),
        eq(schema.outboundMessage.status, "sent"),
        gte(schema.outboundMessage.sentAt, since),
      ),
    );
  return row?.n ?? 0;
}

export async function workspaceSentSince(organizationId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.outboundMessage)
    .where(
      and(
        eq(schema.outboundMessage.organizationId, organizationId),
        eq(schema.outboundMessage.status, "sent"),
        gte(schema.outboundMessage.sentAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** Bounces among the sequence's most recent sends (bounce guard input). */
export async function recentBounceRate(sequenceId: string): Promise<{ sample: number; bounced: number; rate: number }> {
  const rows = await db
    .select({ status: schema.outboundMessage.status })
    .from(schema.outboundMessage)
    .innerJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .where(
      and(eq(schema.enrollment.sequenceId, sequenceId), inArray(schema.outboundMessage.status, ["sent", "bounced"])),
    )
    .orderBy(desc(sql`coalesce(${schema.outboundMessage.sentAt}, ${schema.outboundMessage.createdAt})`))
    .limit(BOUNCE_GUARD_WINDOW);
  const bounced = rows.filter((r) => r.status === "bounced").length;
  return { sample: rows.length, bounced, rate: rows.length ? bounced / rows.length : 0 };
}

/** Daily cap for a mailbox today: its own limit, lowered by the gradual ramp when that policy is on. */
export function mailboxCap(mailbox: MailboxRow, policy: SendingPolicy, now = new Date()): number {
  if (!policy.gradualRamp) return mailbox.dailyLimit;
  return rampLimit(mailbox.dailyLimit, mailbox.warmupStartedAt ?? mailbox.createdAt, now);
}

/** Pause a sequence whose bounce rate is over the workspace threshold, and tell its owner. */
async function bounceGuardPause(sequence: SequenceRow, rate: { sample: number; bounced: number; rate: number }) {
  const ruleset = { ...(sequence.ruleset ?? {}), bounceGuardPausedAt: new Date().toISOString() };
  await db
    .update(schema.sequence)
    .set({ status: "paused", ruleset })
    .where(and(eq(schema.sequence.id, sequence.id), eq(schema.sequence.status, "active")));
  await db.insert(schema.auditLog).values({
    organizationId: sequence.organizationId,
    action: AUTO_PAUSE_AUDIT_ACTION,
    entityType: "sequence",
    entityId: sequence.id,
    metadata: { cause: "bounce_guard", sample: rate.sample, bounced: rate.bounced },
  });
  const ownerId = sequence.ownerId ?? sequence.createdById;
  if (ownerId) {
    await notify(
      [ownerId],
      {
        type: "sequence_paused",
        title: `${sequence.name} was paused`,
        body: `${rate.bounced} of the last ${rate.sample} emails bounced, over the workspace's bounce threshold.`,
        link: `/dashboard/sequences/${sequence.id}`,
      },
      sequence.organizationId,
    );
  }
  logger.info("bounce guard paused a sequence", {
    sequenceId: sequence.id,
    sample: rate.sample,
    bounced: rate.bounced,
  });
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
  bounced: number;
  pendingReview: number;
  tasks: number;
  finished: number;
  skipped: number;
  unresponsive: number;
  /** Due emails left for later because the mailbox, sequence or workspace reached a limit. */
  limited: number;
  /** Due emails left for later because it's outside the schedule's sending window. */
  outsideWindow: number;
}

const LOCK_TTL_SECONDS = 300;

/** Redis lock so two schedulers (or a scheduler and "run now") never process one sequence at once. */
export async function withSequenceLock<T>(sequenceId: string, fn: () => Promise<T>): Promise<T | "locked"> {
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
  linkedin_connect: "linkedin_connect",
  linkedin_message: "linkedin_message",
  linkedin_view: "linkedin_view",
  linkedin_interact: "linkedin_interact",
};

const TASK_VERB: Record<Exclude<StepRow["type"], "auto_email">, string> = {
  call: "Call",
  manual_email: "Email",
  task: "Follow up with",
  linkedin_connect: "Send a LinkedIn connection request to",
  linkedin_message: "Send a LinkedIn message to",
  linkedin_view: "View the LinkedIn profile of",
  linkedin_interact: "Interact with a LinkedIn post by",
};

export function contactName(c: Pick<ContactRow, "firstName" | "lastName" | "email">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "contact";
}

async function companyFor(contact: Pick<ContactRow, "companyId">): Promise<CompanyRow | null> {
  if (!contact.companyId) return null;
  const [row] = await db.select().from(schema.company).where(eq(schema.company.id, contact.companyId)).limit(1);
  return row ?? null;
}

export async function orderedStepRows(sequenceId: string): Promise<StepRow[]> {
  return db
    .select()
    .from(schema.sequenceStep)
    .where(eq(schema.sequenceStep.sequenceId, sequenceId))
    .orderBy(asc(schema.sequenceStep.position), asc(schema.sequenceStep.createdAt));
}

/** Active variants per step, in label order. */
async function activeVariants(stepIds: string[]): Promise<Map<string, VariantRow[]>> {
  const map = new Map<string, VariantRow[]>();
  if (!stepIds.length) return map;
  const rows = await db
    .select()
    .from(schema.stepVariant)
    .where(and(inArray(schema.stepVariant.stepId, stepIds), eq(schema.stepVariant.active, true)))
    .orderBy(asc(schema.stepVariant.label), asc(schema.stepVariant.createdAt));
  for (const r of rows) map.set(r.stepId, [...(map.get(r.stepId) ?? []), r]);
  return map;
}

/** Round-robin across a step's active variants: the one used least so far goes next. */
async function pickVariant(stepId: string, variants: VariantRow[]): Promise<VariantRow | null> {
  if (!variants.length) return null;
  if (variants.length === 1) return variants[0];
  const used = await db
    .select({ variantId: schema.outboundMessage.variantId, n: count() })
    .from(schema.outboundMessage)
    .where(and(eq(schema.outboundMessage.stepId, stepId), isNotNull(schema.outboundMessage.variantId)))
    .groupBy(schema.outboundMessage.variantId);
  const counts = new Map(used.map((u) => [u.variantId, u.n]));
  return variants.reduce((best, v) => ((counts.get(v.id) ?? 0) < (counts.get(best.id) ?? 0) ? v : best), variants[0]);
}

const stripRe = (subject: string) => subject.replace(/^(re:\s*)+/i, "");

/** Subject for a reply-in-thread step: "Re: " + the enrollment's last sent subject, when there is one. */
async function replySubject(enrollmentId: string): Promise<string | null> {
  const [prev] = await db
    .select({ subject: schema.outboundMessage.subject })
    .from(schema.outboundMessage)
    .where(and(eq(schema.outboundMessage.enrollmentId, enrollmentId), eq(schema.outboundMessage.status, "sent")))
    .orderBy(desc(schema.outboundMessage.sentAt))
    .limit(1);
  return prev ? `Re: ${stripRe(prev.subject)}` : null;
}

/** Mark finished contacts unresponsive N days after their last step (ruleset contact trigger). */
async function markUnresponsive(sequence: SequenceRow, ruleset: Ruleset, now: Date): Promise<number> {
  if (!ruleset.unresponsiveAfterDays) return 0;
  const cutoff = new Date(now.getTime() - ruleset.unresponsiveAfterDays * DAY_MS);
  const rows = await db
    .select({ contactId: schema.contact.id, companyId: schema.contact.companyId })
    .from(schema.enrollment)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.enrollment.contactId))
    .where(
      and(
        eq(schema.enrollment.sequenceId, sequence.id),
        eq(schema.enrollment.status, "finished"),
        lte(schema.enrollment.updatedAt, cutoff),
        inArray(schema.contact.stage, ["new", "contacted"]),
      ),
    )
    .limit(BATCH);
  for (const r of rows) {
    const updated = await db
      .update(schema.contact)
      .set({ stage: "unresponsive" })
      .where(and(eq(schema.contact.id, r.contactId), inArray(schema.contact.stage, ["new", "contacted"])))
      .returning({ id: schema.contact.id });
    if (updated.length) {
      await recordEvent({
        organizationId: sequence.organizationId,
        type: "contact_unresponsive",
        summary: `No reply ${ruleset.unresponsiveAfterDays} days after ${sequence.name} finished`,
        contactId: r.contactId,
        companyId: r.companyId,
        metadata: { sequenceId: sequence.id },
      });
    }
  }
  return rows.length;
}

/** One pass over a single sequence. Safe to call repeatedly: every step happens at most once. */
export async function runSequence(sequenceId: string, now = new Date()): Promise<RunResult> {
  const result: RunResult = {
    sequenceId,
    ran: false,
    sent: 0,
    failed: 0,
    blocked: 0,
    bounced: 0,
    pendingReview: 0,
    tasks: 0,
    finished: 0,
    skipped: 0,
    unresponsive: 0,
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
    const policy = await sendingPolicyFor(sequence.organizationId);
    const ruleset = rulesetOf(sequence);
    if (policy.bounceGuard && !ruleset.ignoreBounceProtection) {
      const rate = await recentBounceRate(sequence.id);
      if (rate.sample >= BOUNCE_GUARD_MIN_SAMPLE && rate.rate > policy.bounceThreshold) {
        await bounceGuardPause(sequence, rate);
        result.note = `Bounce guard paused this sequence: ${rate.bounced} of the last ${rate.sample} emails bounced.`;
        return;
      }
    }
    if (policy.requireSignature && !mailbox.signature?.trim()) {
      result.note = "Sending protection requires a signature. Add one to the mailbox to send.";
      return;
    }
    result.ran = true;
    result.unresponsive = await markUnresponsive(sequence, ruleset, now);

    const steps = await orderedStepRows(sequence.id);
    const variants = await activeVariants(steps.map((s) => s.id));
    const ctx: DeliveryContext = { sequence, mailbox, steps };
    const [schedule] = sequence.scheduleId
      ? await db
          .select()
          .from(schema.sendingSchedule)
          .where(
            and(
              eq(schema.sendingSchedule.id, sequence.scheduleId),
              eq(schema.sendingSchedule.organizationId, sequence.organizationId),
            ),
          )
          .limit(1)
      : [];
    const inWindow = schedule
      ? inSchedule(schedule, now)
      : inSendingWindow(mailbox.sendingWindowStart, mailbox.sendingWindowEnd, mailbox.timezone, now);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const cap = mailboxCap(mailbox, policy, now);
    let sentToday = await sentTodayCount(mailbox, now);
    let sequenceSent = sequence.maxPer24h ? await sequenceSentSince(sequence.id, dayAgo) : 0;
    let workspaceSent = policy.workspaceDailyLimit ? await workspaceSentSince(sequence.organizationId, dayAgo) : 0;
    const origin = await workspaceOrigin(sequence.organizationId);
    const canSend = () =>
      mailbox.status !== "paused" &&
      sentToday < cap &&
      (!sequence.maxPer24h || sequenceSent < sequence.maxPer24h) &&
      (!policy.workspaceDailyLimit || workspaceSent < policy.workspaceDailyLimit);

    const tally = (outcome: DeliveryOutcome) => {
      if (outcome === "sent") {
        result.sent++;
        sentToday++;
        sequenceSent++;
        workspaceSent++;
      } else if (outcome === "failed") result.failed++;
      else if (outcome === "bounced") result.bounced++;
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

      // A step switched off after the contact reached it: jump to the next enabled one.
      if (!step.enabled) {
        const nextIndex = nextEnabledIndex(steps, enrollment.currentStep + 1);
        await db
          .update(schema.enrollment)
          .set(
            nextIndex >= 0
              ? { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + stepDelayMs(steps[nextIndex])) }
              : { currentStep: steps.length, status: "finished", nextRunAt: null },
          )
          .where(
            and(eq(schema.enrollment.id, enrollment.id), eq(schema.enrollment.currentStep, enrollment.currentStep)),
          );
        result.skipped++;
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
        await advance(enrollment, steps, sequence, contact, now);
        continue;
      }
      if (existing && existing.status !== "blocked") {
        await hold(enrollment.id);
        continue;
      }

      const company = await companyFor(contact);
      const values = mergeValuesFor(contact, company);

      if (step.type !== "auto_email") {
        const note = step.body ? renderTemplate(step.body, values).text : null;
        const label = `${TASK_VERB[step.type]} ${contactName(contact)}`;
        const moved = await advance(enrollment, steps, sequence, contact, now);
        if (moved) {
          const [task] = await db
            .insert(schema.task)
            .values({
              organizationId: sequence.organizationId,
              assigneeId: sequence.ownerId ?? enrollment.enrolledById ?? contact.ownerId,
              contactId: contact.id,
              companyId: contact.companyId,
              enrollmentId: enrollment.id,
              type: TASK_TYPE[step.type],
              title: `${label} (${sequence.name}, step ${enrollment.currentStep + 1})`.slice(0, 200),
              note:
                step.type === "manual_email" && step.subject
                  ? `Subject: ${renderTemplate(step.subject, values).text}\n\n${note ?? ""}`
                  : note,
              dueAt: now,
            })
            .returning({ id: schema.task.id, title: schema.task.title });
          await recordEvent({
            organizationId: sequence.organizationId,
            type: "task_created",
            summary: `Task created: ${task.title}`,
            contactId: contact.id,
            companyId: contact.companyId,
            metadata: { taskId: task.id, sequenceId: sequence.id, enrollmentId: enrollment.id, stepId: step.id },
          });
          result.tasks++;
        }
        continue;
      }

      const variant = await pickVariant(step.id, variants.get(step.id) ?? []);
      const rawSubject = variant ? variant.subject : step.subject;
      const rawBody = variant ? variant.body : step.body;
      const threaded = step.threadMode === "reply" ? await replySubject(enrollment.id) : null;
      const subject = threaded ? { text: threaded, missing: [] } : renderTemplate(rawSubject ?? "", values);
      const body = renderTemplate(rawBody ?? "", values);
      const missing = [...new Set([...subject.missing, ...body.missing])];
      const toEmail = contact.email ?? "";
      const unsubscribeUrl = `${origin}/u/${unsubscribeToken(sequence.organizationId, contact.id)}`;
      const base = {
        organizationId: sequence.organizationId,
        mailboxId: mailbox.id,
        contactId: contact.id,
        enrollmentId: enrollment.id,
        stepId: step.id,
        variantId: variant?.id ?? null,
        toEmail: toEmail || "(no email)",
        subject: subject.text.slice(0, 998) || "(no subject)",
        body: composeBody(body.text, mailbox, unsubscribeUrl),
      };

      const notSent = notSentReason(ruleset, contact, company);
      const reason =
        (await blockReason(sequence.organizationId, contact, contact.email)) ??
        notSent ??
        policyHoldReason(policy, contact.emailStatus) ??
        (!subject.text.trim() ? "The email has no subject." : null) ??
        (missing.length ? `Missing merge field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` : null);
      if (reason) {
        const [blocked] = await db
          .insert(schema.outboundMessage)
          .values({ ...base, status: "blocked", blockedReason: reason })
          .returning();
        await hold(enrollment.id, statusAfterBlock(reason));
        await recordEvent({
          organizationId: sequence.organizationId,
          type: "email_not_sent",
          summary: `Email not sent: ${reason}`,
          contactId: contact.id,
          companyId: contact.companyId,
          metadata: eventMeta(blocked, ctx),
        });
        result.blocked++;
        continue;
      }

      const needsReview =
        sequence.reviewMode === "all" ||
        (sequence.reviewMode === "first_step" && enrollment.currentStep === nextEnabledIndex(steps, 0));
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

/* -------------------------------------------------------------------------- */
/* One-off emails (composer)                                                  */
/* -------------------------------------------------------------------------- */

/** Send scheduled one-off emails whose time has come. Window and limits of their mailbox apply. */
export async function runDueOneOffs(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(schema.outboundMessage)
    .where(
      and(
        isNull(schema.outboundMessage.enrollmentId),
        eq(schema.outboundMessage.status, "queued"),
        isNotNull(schema.outboundMessage.scheduledAt),
        lte(schema.outboundMessage.scheduledAt, now),
      ),
    )
    .orderBy(asc(schema.outboundMessage.scheduledAt))
    .limit(BATCH);
  let processed = 0;
  for (const message of due) {
    if (!message.mailboxId) continue;
    const [mailbox] = await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, message.mailboxId)).limit(1);
    if (!mailbox || mailboxIssues(mailbox).length) continue;
    const policy = await sendingPolicyFor(message.organizationId);
    if ((await sentTodayCount(mailbox, now)) >= mailboxCap(mailbox, policy, now)) continue;
    if (
      policy.workspaceDailyLimit &&
      (await workspaceSentSince(message.organizationId, new Date(now.getTime() - DAY_MS))) >= policy.workspaceDailyLimit
    ) {
      continue;
    }
    await deliver(message, { sequence: null, mailbox, steps: [] });
    processed++;
  }
  return processed;
}

/** Scheduler entry point: one pass over every active sequence, then scheduled one-off emails. */
export async function runDueSequences(): Promise<{ processed: number; note?: string }> {
  const active = await db
    .select({ id: schema.sequence.id })
    .from(schema.sequence)
    .where(eq(schema.sequence.status, "active"));
  let processed = 0;
  for (const { id } of active) {
    try {
      const r = await runSequence(id);
      processed += r.sent + r.blocked + r.pendingReview + r.tasks + r.failed + r.finished + r.bounced;
    } catch (error) {
      logger.error("sequence run failed", { sequenceId: id, error });
    }
  }
  try {
    processed += await runDueOneOffs();
  } catch (error) {
    logger.error("one-off run failed", { error });
  }
  return { processed, note: `${active.length} active sequence${active.length === 1 ? "" : "s"}` };
}
