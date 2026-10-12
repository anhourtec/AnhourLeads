import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import { findMailbox, mailboxIssues, mailboxTransport, sentTodayCount, smtpErrorMessage } from "./mailboxes";
import {
  composeBody,
  deliver,
  type MessageRow,
  mailboxCap,
  mergeValuesFor,
  orderedStepRows,
  renderTemplate,
  unsubscribeToken,
  withSequenceLock,
  workspaceOrigin,
} from "./sending";
import { sendingPolicyFor } from "./sending-guards";

/**
 * The Emails screen: every message the workspace sent, scheduled, held for review or blocked, plus
 * one-off emails from the composer. Sequences create their messages in the sending engine.
 */

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/** Status groups shown as tabs on the Emails screen. */
export const MESSAGE_GROUPS = ["scheduled", "delivered", "replied", "bounced", "not_sent", "failed"] as const;
export type MessageGroup = (typeof MESSAGE_GROUPS)[number];

function boolParam(v: unknown): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

export const messageSearchSchema = z.object({
  status: z.enum(schema.outboundMessage.status.enumValues).optional(),
  group: z.enum(MESSAGE_GROUPS).optional(),
  sequenceId: z.string().min(1).max(100).optional(),
  mailboxId: z.string().min(1).max(100).optional(),
  contactId: z.string().min(1).max(100).optional(),
  /** Only one-off emails (not from a sequence). */
  oneOff: z.preprocess(boolParam, z.boolean()).optional(),
  q: z.string().trim().max(200).optional(),
});

export interface MessageView {
  id: string;
  status: MessageRow["status"];
  toEmail: string;
  subject: string;
  body: string;
  blockedReason: string | null;
  error: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  replied: boolean;
  mailbox: { id: string; email: string } | null;
  contact: { id: string; name: string } | null;
  sequence: { id: string; name: string } | null;
  stepPosition: number | null;
  variantLabel: string | null;
}

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function groupWhere(group: MessageGroup): SQL {
  const o = schema.outboundMessage;
  switch (group) {
    case "scheduled":
      return inArray(o.status, ["pending_review", "queued"]);
    case "delivered":
      return eq(o.status, "sent");
    case "replied":
      return and(eq(o.status, "sent"), eq(schema.enrollment.status, "replied")) as SQL;
    case "bounced":
      return eq(o.status, "bounced");
    case "not_sent":
      return eq(o.status, "blocked");
    case "failed":
      return eq(o.status, "failed");
  }
}

function filtersWhere(actor: Actor, filters: z.infer<typeof messageSearchSchema>, messageId?: string): SQL[] {
  const o = schema.outboundMessage;
  const where: SQL[] = [eq(o.organizationId, actor.organizationId)];
  if (messageId) where.push(eq(o.id, messageId));
  if (filters.status) where.push(eq(o.status, filters.status));
  if (filters.group) where.push(groupWhere(filters.group));
  if (filters.sequenceId) where.push(eq(schema.enrollment.sequenceId, filters.sequenceId));
  if (filters.mailboxId) where.push(eq(o.mailboxId, filters.mailboxId));
  if (filters.contactId) where.push(eq(o.contactId, filters.contactId));
  if (filters.oneOff) where.push(isNull(o.enrollmentId));
  if (filters.q)
    where.push(or(ilike(o.toEmail, escapeLike(filters.q)), ilike(o.subject, escapeLike(filters.q))) as SQL);
  return where;
}

export async function searchMessages(
  actor: Actor,
  input: unknown,
  page: Page,
  messageId?: string,
): Promise<{ messages: MessageView[]; total: number }> {
  const filters = messageSearchSchema.parse(input ?? {});
  const where = filtersWhere(actor, filters, messageId);
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
      variantLabel: schema.stepVariant.label,
      enrollmentStatus: schema.enrollment.status,
    })
    .from(schema.outboundMessage)
    .leftJoin(schema.enrollment, eq(schema.enrollment.id, schema.outboundMessage.enrollmentId))
    .leftJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
    .leftJoin(schema.mailbox, eq(schema.mailbox.id, schema.outboundMessage.mailboxId))
    .leftJoin(schema.contact, eq(schema.contact.id, schema.outboundMessage.contactId))
    .leftJoin(schema.sequenceStep, eq(schema.sequenceStep.id, schema.outboundMessage.stepId))
    .leftJoin(schema.stepVariant, eq(schema.stepVariant.id, schema.outboundMessage.variantId))
    .where(and(...where))
    .orderBy(
      desc(sql`coalesce(${schema.outboundMessage.sentAt}, ${schema.outboundMessage.createdAt})`),
      asc(schema.outboundMessage.id),
    )
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
      scheduledAt: r.message.scheduledAt?.toISOString() ?? null,
      sentAt: r.message.sentAt?.toISOString() ?? null,
      createdAt: r.message.createdAt.toISOString(),
      replied: r.message.status === "sent" && r.enrollmentStatus === "replied",
      mailbox: r.message.mailboxId && r.mailboxEmail ? { id: r.message.mailboxId, email: r.mailboxEmail } : null,
      contact: r.message.contactId
        ? {
            id: r.message.contactId,
            name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.contactEmail || r.message.toEmail,
          }
        : null,
      sequence: r.sequenceId && r.sequenceName ? { id: r.sequenceId, name: r.sequenceName } : null,
      stepPosition: r.stepPosition ?? null,
      variantLabel: r.variantLabel ?? null,
    })),
  };
}

/** Counts per status group (for the tabs), with the same mailbox / search filters. */
export async function messageGroupCounts(actor: Actor, input: unknown): Promise<Record<MessageGroup, number>> {
  const filters = messageSearchSchema.parse(input ?? {});
  const where = filtersWhere(actor, { ...filters, group: undefined, status: undefined });
  const o = schema.outboundMessage;
  const [row] = await db
    .select({
      scheduled: sql<number>`count(*) filter (where ${o.status} in ('pending_review', 'queued'))::int`,
      delivered: sql<number>`count(*) filter (where ${o.status} = 'sent')::int`,
      replied: sql<number>`count(*) filter (where ${o.status} = 'sent' and ${schema.enrollment.status} = 'replied')::int`,
      bounced: sql<number>`count(*) filter (where ${o.status} = 'bounced')::int`,
      not_sent: sql<number>`count(*) filter (where ${o.status} = 'blocked')::int`,
      failed: sql<number>`count(*) filter (where ${o.status} = 'failed')::int`,
    })
    .from(o)
    .leftJoin(schema.enrollment, eq(schema.enrollment.id, o.enrollmentId))
    .where(and(...where));
  return {
    scheduled: Number(row?.scheduled ?? 0),
    delivered: Number(row?.delivered ?? 0),
    replied: Number(row?.replied ?? 0),
    bounced: Number(row?.bounced ?? 0),
    not_sent: Number(row?.not_sent ?? 0),
    failed: Number(row?.failed ?? 0),
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

export async function messageView(actor: Actor, id: string): Promise<MessageView> {
  const { messages } = await searchMessages(actor, {}, { page: 1, perPage: 1, offset: 0 }, id);
  const [view] = messages;
  if (!view) throw notFound("Message not found.");
  return view;
}

export interface MessageDetail extends MessageView {
  headers: { name: string; value: string }[];
  events: { id: string; type: string; summary: string; occurredAt: string }[];
}

/** One message with the headers it was (or will be) sent with and its timeline. */
export async function messageDetail(actor: Actor, id: string): Promise<MessageDetail> {
  const view = await messageView(actor, id);
  const { message, sequence } = await findMessage(actor, id);
  const [mailbox] = message.mailboxId
    ? await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, message.mailboxId)).limit(1)
    : [];
  const headers: { name: string; value: string }[] = [];
  if (mailbox) {
    headers.push({
      name: "From",
      value: mailbox.displayName ? `${mailbox.displayName} <${mailbox.email}>` : mailbox.email,
    });
  }
  headers.push({ name: "To", value: message.toEmail }, { name: "Subject", value: message.subject });
  if (sequence?.cc) headers.push({ name: "Cc", value: sequence.cc });
  if (sequence?.bcc) headers.push({ name: "Bcc", value: sequence.bcc });
  if (message.providerMessageId) headers.push({ name: "Message-ID", value: message.providerMessageId });
  if (message.contactId) {
    const origin = await workspaceOrigin(message.organizationId);
    headers.push(
      {
        name: "List-Unsubscribe",
        value: `<${origin}/u/${unsubscribeToken(message.organizationId, message.contactId)}>`,
      },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    );
  }
  const events = await db
    .select({
      id: schema.activity.id,
      type: schema.activity.type,
      summary: schema.activity.summary,
      occurredAt: schema.activity.occurredAt,
    })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.organizationId, actor.organizationId),
        sql`${schema.activity.metadata}->>'messageId' = ${message.id}`,
      ),
    )
    .orderBy(asc(schema.activity.occurredAt))
    .limit(100);
  return {
    ...view,
    headers,
    events: [
      { id: `${message.id}:created`, type: "created", summary: "Created", occurredAt: message.createdAt.toISOString() },
      ...events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Review                                                                     */
/* -------------------------------------------------------------------------- */

/** Approve a message held for review. The engine sends it on its next pass, inside the sending window. */
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
 * Send now, ignoring the sending window (a person chose to send it). Compliance checks, the sending
 * policy and the mailbox's daily limit still apply. Works for sequence and one-off messages.
 */
export async function sendMessageNow(actor: Actor, id: string): Promise<{ message: MessageView }> {
  const { message, sequence } = await findMessage(actor, id);
  if (!["pending_review", "queued", "failed"].includes(message.status)) {
    throw new HttpError(422, "This message can't be sent. Only messages under review, queued or failed can.");
  }
  if (message.enrollmentId && !sequence) throw new HttpError(422, "This message's sequence was removed.");
  if (sequence && sequence.status !== "active") {
    throw new HttpError(422, "Activate the sequence before sending its messages.");
  }
  const [mailbox] = message.mailboxId
    ? await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, message.mailboxId)).limit(1)
    : [];
  if (!mailbox) throw new HttpError(422, "The mailbox for this message was removed.");
  const issues = mailboxIssues(mailbox);
  if (issues.length) throw new HttpError(422, issues[0]);
  const policy = await sendingPolicyFor(message.organizationId);
  if ((await sentTodayCount(mailbox)) >= mailboxCap(mailbox, policy)) {
    throw new HttpError(422, "This mailbox reached its daily limit. It will send again tomorrow.");
  }
  if (sequence) {
    const steps = await orderedStepRows(sequence.id);
    const outcome = await withSequenceLock(sequence.id, () => deliver(message, { sequence, mailbox, steps }));
    if (outcome === "locked") throw new HttpError(409, "This sequence is sending right now. Try again shortly.");
    await audit(actor, "message.send_now", "outbound_message", message.id, { outcome });
  } else {
    const outcome = await deliver(message, { sequence: null, mailbox, steps: [] });
    await audit(actor, "message.send_now", "outbound_message", message.id, { outcome });
  }
  return { message: await messageView(actor, message.id) };
}

/* -------------------------------------------------------------------------- */
/* One-off composer                                                           */
/* -------------------------------------------------------------------------- */

export const composeSchema = z
  .object({
    mailboxId: z.string().min(1).max(100),
    contactId: z.string().min(1).max(100).optional(),
    toEmail: z.email("Enter a valid email address.").max(254).optional(),
    subject: z.string().trim().min(1, "Add a subject.").max(300),
    body: z
      .string()
      .max(20_000)
      .refine((v) => v.trim().length > 0, "Write the email."),
    /** When to send. Omit to keep it queued for "Send now". */
    scheduledAt: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "Use an ISO date and time.")
      .transform((v) => new Date(v))
      .optional(),
  })
  .strict()
  .refine((v) => v.contactId || v.toEmail, { message: "Choose who to send it to.", path: ["toEmail"] });

/**
 * Create a one-off email. Merge fields render for the chosen contact; the footer (sender, postal
 * address, unsubscribe) is added like every other email. It is sent by "send now" or, when
 * `scheduledAt` is given, by the engine once that time comes.
 */
export async function composeMessage(actor: Actor, input: unknown): Promise<{ message: MessageView }> {
  const data = composeSchema.parse(input);
  const mailbox = await findMailbox(actor, data.mailboxId).catch(() => {
    throw new HttpError(422, "Pick a mailbox from this workspace.", [{ path: "mailboxId", message: "Not found." }]);
  });
  let contact: typeof schema.contact.$inferSelect | undefined;
  if (data.contactId) {
    [contact] = await db
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.id, data.contactId), eq(schema.contact.organizationId, actor.organizationId)))
      .limit(1);
    if (!contact)
      throw new HttpError(422, "Some fields are invalid.", [{ path: "contactId", message: "Contact not found." }]);
  }
  if (!contact && data.toEmail) {
    // Every email carries a working unsubscribe link, which needs a contact record to act on.
    [contact] = await db
      .select()
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.organizationId, actor.organizationId),
          sql`lower(${schema.contact.email}) = ${data.toEmail.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (!contact) {
      throw new HttpError(422, "Add this person as a contact first, so they can unsubscribe.", [
        { path: "toEmail", message: "No contact with this email." },
      ]);
    }
  }
  const toEmail = data.toEmail ?? contact?.email;
  if (!toEmail) {
    throw new HttpError(422, "This contact has no email address.", [{ path: "toEmail", message: "No email address." }]);
  }
  let subject = data.subject;
  let body = data.body;
  if (contact) {
    const [company] = contact.companyId
      ? await db.select().from(schema.company).where(eq(schema.company.id, contact.companyId)).limit(1)
      : [];
    const values = mergeValuesFor(contact, company ?? null);
    const s = renderTemplate(subject, values);
    const b = renderTemplate(body, values);
    const missing = [...new Set([...s.missing, ...b.missing])];
    if (missing.length) {
      throw new HttpError(422, `This contact has no value for: ${missing.join(", ")}.`, [
        { path: "body", message: "Missing merge fields." },
      ]);
    }
    subject = s.text;
    body = b.text;
  }
  const origin = await workspaceOrigin(actor.organizationId);
  if (!contact) throw new HttpError(422, "Choose who to send it to.");
  const unsubscribeUrl = `${origin}/u/${unsubscribeToken(actor.organizationId, contact.id)}`;
  const [row] = await db
    .insert(schema.outboundMessage)
    .values({
      organizationId: actor.organizationId,
      mailboxId: mailbox.id,
      contactId: contact.id,
      toEmail: toEmail.toLowerCase(),
      subject: subject.slice(0, 998),
      body: composeBody(body, mailbox, unsubscribeUrl),
      status: "queued",
      scheduledAt: data.scheduledAt ?? null,
    })
    .returning({ id: schema.outboundMessage.id });
  await audit(actor, "message.compose", "outbound_message", row.id, { scheduled: Boolean(data.scheduledAt) });
  return { message: await messageView(actor, row.id) };
}

/** Delete a one-off email that hasn't been sent (a draft or scheduled message). */
export async function discardMessage(actor: Actor, id: string): Promise<void> {
  const { message } = await findMessage(actor, id);
  if (message.enrollmentId) throw new HttpError(422, "Sequence emails are managed from their sequence.");
  if (!["queued", "failed", "pending_review"].includes(message.status)) {
    throw new HttpError(422, "Only unsent emails can be discarded.");
  }
  await db.delete(schema.outboundMessage).where(eq(schema.outboundMessage.id, message.id));
  await audit(actor, "message.discard", "outbound_message", message.id);
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

export const emailAnalyticsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  mailboxId: z.string().min(1).max(100).optional(),
});

export interface EmailAnalytics {
  days: number;
  totals: { sent: number; delivered: number; bounced: number; replied: number; notSent: number; failed: number };
  series: { date: string; sent: number; bounced: number; replied: number }[];
  mailboxes: { id: string; email: string; sent: number; bounced: number; replied: number; bounceRate: number | null }[];
}

/** Sent, delivered, bounced and replied over time, per mailbox. */
export async function emailAnalytics(actor: Actor, input: unknown): Promise<EmailAnalytics> {
  const { days, mailboxId } = emailAnalyticsSchema.parse(input ?? {});
  const since = new Date(Date.now() - days * 86_400_000);
  const o = schema.outboundMessage;
  const scope: SQL[] = [
    eq(o.organizationId, actor.organizationId),
    gte(sql`coalesce(${o.sentAt}, ${o.createdAt})`, since),
  ];
  if (mailboxId) scope.push(eq(o.mailboxId, mailboxId));
  const day = sql<string>`to_char(date_trunc('day', coalesce(${o.sentAt}, ${o.createdAt}) at time zone 'UTC'), 'YYYY-MM-DD')`;
  const daily = await db
    .select({
      date: day,
      sent: sql<number>`count(*) filter (where ${o.status} in ('sent', 'bounced'))::int`,
      bounced: sql<number>`count(*) filter (where ${o.status} = 'bounced')::int`,
      notSent: sql<number>`count(*) filter (where ${o.status} = 'blocked')::int`,
      failed: sql<number>`count(*) filter (where ${o.status} = 'failed')::int`,
    })
    .from(o)
    .where(and(...scope))
    .groupBy(day);
  const a = schema.activity;
  const replyScope: SQL[] = [
    eq(a.organizationId, actor.organizationId),
    eq(a.type, "email_replied"),
    gte(a.occurredAt, since),
  ];
  if (mailboxId) replyScope.push(sql`${a.metadata}->>'mailboxId' = ${mailboxId}`);
  const replyDay = sql<string>`to_char(date_trunc('day', ${a.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const replies = await db
    .select({ date: replyDay, mailboxId: sql<string | null>`${a.metadata}->>'mailboxId'`, n: count() })
    .from(a)
    .where(and(...replyScope))
    .groupBy(replyDay, sql`${a.metadata}->>'mailboxId'`);
  const perMailbox = await db
    .select({
      id: schema.mailbox.id,
      email: schema.mailbox.email,
      sent: sql<number>`count(${o.id}) filter (where ${o.status} in ('sent', 'bounced'))::int`,
      bounced: sql<number>`count(${o.id}) filter (where ${o.status} = 'bounced')::int`,
    })
    .from(schema.mailbox)
    .leftJoin(o, and(eq(o.mailboxId, schema.mailbox.id), gte(sql`coalesce(${o.sentAt}, ${o.createdAt})`, since)))
    .where(
      and(
        eq(schema.mailbox.organizationId, actor.organizationId),
        ...(mailboxId ? [eq(schema.mailbox.id, mailboxId)] : []),
      ),
    )
    .groupBy(schema.mailbox.id, schema.mailbox.email)
    .orderBy(asc(schema.mailbox.email));

  const series: EmailAnalytics["series"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const d = daily.find((r) => r.date === date);
    series.push({
      date,
      sent: Number(d?.sent ?? 0),
      bounced: Number(d?.bounced ?? 0),
      replied: replies.filter((r) => r.date === date).reduce((s, r) => s + r.n, 0),
    });
  }
  const sum = (key: "sent" | "bounced" | "notSent" | "failed") => daily.reduce((s, r) => s + Number(r[key]), 0);
  const replied = replies.reduce((s, r) => s + r.n, 0);
  return {
    days,
    totals: {
      sent: sum("sent"),
      delivered: sum("sent") - sum("bounced"),
      bounced: sum("bounced"),
      replied,
      notSent: sum("notSent"),
      failed: sum("failed"),
    },
    series,
    mailboxes: perMailbox.map((m) => {
      const r = replies.filter((x) => x.mailboxId === m.id).reduce((s, x) => s + x.n, 0);
      return {
        id: m.id,
        email: m.email,
        sent: Number(m.sent),
        bounced: Number(m.bounced),
        replied: r,
        bounceRate: Number(m.sent) ? Number(m.bounced) / Number(m.sent) : null,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Test email                                                                 */
/* -------------------------------------------------------------------------- */

export const testEmailSchema = z
  .object({
    subject: z.string().max(300).nullish(),
    body: z
      .string()
      .max(20_000)
      .refine((v) => v.trim().length > 0, "Write the email first."),
    /** Render merge fields for this contact; sample values are used otherwise. */
    contactId: z.string().min(1).max(100).optional(),
  })
  .strict();

const SAMPLE: MergeValuesInput = {
  first_name: "Sam",
  last_name: "Lee",
  full_name: "Sam Lee",
  email: "sam@example.com",
  title: "Head of sales",
  company: "Example Co",
  company_domain: "example.com",
  city: "London",
  country: "United Kingdom",
};
type MergeValuesInput = Parameters<typeof renderTemplate>[1];

/** "Send me a test email": the step as written, to the signed-in person, from the sequence's mailbox. */
export async function sendTestEmail(actor: Actor, sequenceId: string, input: unknown): Promise<{ to: string }> {
  const data = testEmailSchema.parse(input);
  if (!actor.userId) throw new HttpError(422, "Test emails go to a signed-in person. API keys can't receive them.");
  const [sequence] = await db
    .select()
    .from(schema.sequence)
    .where(and(eq(schema.sequence.id, sequenceId), eq(schema.sequence.organizationId, actor.organizationId)))
    .limit(1);
  if (!sequence) throw notFound("Sequence not found.");
  if (!sequence.mailboxId) throw new HttpError(422, "Pick a mailbox in the sequence settings first.");
  const mailbox = await findMailbox(actor, sequence.mailboxId);
  const issues = mailboxIssues(mailbox);
  if (issues.length) throw new HttpError(422, issues[0]);
  const [user] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, actor.userId))
    .limit(1);
  if (!user) throw notFound("User not found.");
  let values = SAMPLE;
  if (data.contactId) {
    const [contact] = await db
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.id, data.contactId), eq(schema.contact.organizationId, actor.organizationId)))
      .limit(1);
    if (!contact)
      throw new HttpError(422, "Some fields are invalid.", [{ path: "contactId", message: "Contact not found." }]);
    const [company] = contact.companyId
      ? await db.select().from(schema.company).where(eq(schema.company.id, contact.companyId)).limit(1)
      : [];
    values = mergeValuesFor(contact, company ?? null);
  }
  const subject = renderTemplate(data.subject || "(no subject)", values).text;
  const body = renderTemplate(data.body, values).text;
  const transport = mailboxTransport(mailbox);
  if (!transport) throw new HttpError(422, "The mailbox has no SMTP settings.");
  const origin = await workspaceOrigin(actor.organizationId);
  try {
    await transport.sendMail({
      from: mailbox.displayName ? { name: mailbox.displayName, address: mailbox.email } : mailbox.email,
      to: user.email,
      subject: `[Test] ${subject}`.slice(0, 998),
      text: composeBody(body, mailbox, `${origin}/u/test`),
    });
  } catch (error) {
    throw new HttpError(422, smtpErrorMessage(error, mailbox));
  } finally {
    transport.close();
  }
  await audit(actor, "sequence.test_email", "sequence", sequence.id);
  return { to: user.email };
}
