import "server-only";

import { and, asc, count, eq, gte, inArray, ne, sql } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { decryptSecret, encryptSecret, secretHint } from "@/server/crypto/secrets";
import { db, schema } from "@/server/db";
import { conflict, HttpError, notFound } from "@/server/http/errors";
import { log } from "@/server/log";

import { audit } from "./audit";

/* -------------------------------------------------------------------------- */
/* Time helpers: sending windows and "today" in a mailbox's time zone          */
/* -------------------------------------------------------------------------- */

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Midnight today in `timeZone`, as an instant. */
export function startOfDayIn(timeZone: string, now = new Date()): Date {
  const p = zonedParts(now, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offset);
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** True when `now` falls inside the HH:MM window in `timeZone`. Windows may wrap past midnight. */
export function inSendingWindow(start: string, end: string, timeZone: string, now = new Date()): boolean {
  const p = zonedParts(now, timeZone);
  const minute = p.hour * 60 + p.minute;
  const from = toMinutes(start);
  const to = toMinutes(end);
  return from <= to ? minute >= from && minute <= to : minute >= from || minute <= to;
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM.");
const timezone = z.string().trim().min(1).max(64).refine(isTimeZone, "Use an IANA time zone such as Europe/London.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const fields = {
  provider: z.enum(["google", "microsoft", "smtp"]),
  displayName: optionalText(120),
  dailyLimit: z.number().int().min(1, "At least 1 a day.").max(500, "At most 500 a day."),
  sendingWindowStart: hhmm,
  sendingWindowEnd: hhmm,
  timezone,
  status: z.enum(["active", "paused", "disconnected", "warming"]),
  smtpHost: optionalText(253),
  smtpPort: z.number().int().min(1).max(65535).nullish(),
  smtpSecure: z.enum(["ssl", "starttls", "none"]),
  smtpUser: optionalText(254),
  smtpPassword: z.string().max(500).nullish(),
  postalAddress: optionalText(500),
  signature: optionalText(2000),
};

export const createMailboxSchema = z
  .object({
    email: z.email("Enter a valid email address.").max(254),
    provider: fields.provider.default("smtp"),
    displayName: fields.displayName,
    dailyLimit: fields.dailyLimit.default(50),
    sendingWindowStart: fields.sendingWindowStart.default("09:00"),
    sendingWindowEnd: fields.sendingWindowEnd.default("17:00"),
    timezone: fields.timezone.default("UTC"),
    status: fields.status.default("active"),
    smtpHost: fields.smtpHost,
    smtpPort: fields.smtpPort,
    smtpSecure: fields.smtpSecure.default("starttls"),
    smtpUser: fields.smtpUser,
    smtpPassword: fields.smtpPassword,
    postalAddress: fields.postalAddress,
    signature: fields.signature,
  })
  .strict();

export const updateMailboxSchema = z
  .object({
    email: z.email("Enter a valid email address.").max(254),
    provider: fields.provider,
    displayName: fields.displayName,
    dailyLimit: fields.dailyLimit,
    sendingWindowStart: fields.sendingWindowStart,
    sendingWindowEnd: fields.sendingWindowEnd,
    timezone: fields.timezone,
    status: fields.status,
    smtpHost: fields.smtpHost,
    smtpPort: fields.smtpPort,
    smtpSecure: fields.smtpSecure,
    smtpUser: fields.smtpUser,
    /** Empty string or null clears the stored password; omit to keep it. */
    smtpPassword: fields.smtpPassword,
    postalAddress: fields.postalAddress,
    signature: fields.signature,
  })
  .partial()
  .strict();

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

export type MailboxRow = typeof schema.mailbox.$inferSelect;

export interface MailboxView {
  id: string;
  userId: string | null;
  email: string;
  provider: MailboxRow["provider"];
  displayName: string | null;
  dailyLimit: number;
  sentToday: number;
  sendingWindowStart: string;
  sendingWindowEnd: string;
  timezone: string;
  status: MailboxRow["status"];
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: MailboxRow["smtpSecure"];
  smtpUser: string | null;
  hasPassword: boolean;
  passwordHint: string | null;
  postalAddress: string | null;
  signature: string | null;
  warmupStartedAt: string | null;
  /** Plain-language problems that stop or hurt sending from this mailbox. */
  issues: string[];
  readyToSend: boolean;
  activeSequences: number;
  createdAt: string;
  updatedAt: string;
}

/** What stops a mailbox from being used by an active sequence. Empty when it can send. */
export function mailboxIssues(m: Pick<MailboxRow, "smtpHost" | "postalAddress" | "status">): string[] {
  const issues: string[] = [];
  if (!m.smtpHost) issues.push("Add SMTP settings so the app can send from this mailbox.");
  if (!m.postalAddress) issues.push("Add a postal address. Every message must identify the sender.");
  if (m.status === "paused" || m.status === "disconnected") issues.push(`The mailbox is ${m.status}.`);
  return issues;
}

export async function sentTodayCount(mailbox: Pick<MailboxRow, "id" | "timezone">, now = new Date()) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.outboundMessage)
    .where(
      and(
        eq(schema.outboundMessage.mailboxId, mailbox.id),
        eq(schema.outboundMessage.status, "sent"),
        gte(schema.outboundMessage.sentAt, startOfDayIn(mailbox.timezone, now)),
      ),
    );
  return row?.n ?? 0;
}

/** Sent-today counts for many mailboxes in one query, each using its own time zone's midnight. */
async function sentTodayCounts(organizationId: string): Promise<Map<string, number>> {
  const m = schema.mailbox;
  const o = schema.outboundMessage;
  const rows = await db
    .select({ id: m.id, n: count(o.id) })
    .from(m)
    .leftJoin(
      o,
      and(
        eq(o.mailboxId, m.id),
        eq(o.status, "sent"),
        gte(o.sentAt, sql`(date_trunc('day', now() at time zone ${m.timezone}) at time zone ${m.timezone})`),
      ),
    )
    .where(eq(m.organizationId, organizationId))
    .groupBy(m.id);
  return new Map(rows.map((r) => [r.id, r.n]));
}

async function activeSequenceCounts(organizationId: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ mailboxId: schema.sequence.mailboxId, n: count() })
    .from(schema.sequence)
    .where(
      and(
        eq(schema.sequence.organizationId, organizationId),
        eq(schema.sequence.status, "active"),
        inArray(schema.sequence.mailboxId, ids),
      ),
    )
    .groupBy(schema.sequence.mailboxId);
  return new Map(rows.map((r) => [r.mailboxId ?? "", r.n]));
}

function toView(row: MailboxRow, sentToday: number, activeSequences: number): MailboxView {
  const plain = row.smtpPasswordEnc ? decryptSecret(row.smtpPasswordEnc) : null;
  const issues = mailboxIssues(row);
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    provider: row.provider,
    displayName: row.displayName,
    dailyLimit: row.dailyLimit,
    sentToday,
    sendingWindowStart: row.sendingWindowStart,
    sendingWindowEnd: row.sendingWindowEnd,
    timezone: row.timezone,
    status: row.status,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser,
    hasPassword: Boolean(row.smtpPasswordEnc),
    passwordHint: secretHint(plain),
    postalAddress: row.postalAddress,
    signature: row.signature,
    warmupStartedAt: row.warmupStartedAt?.toISOString() ?? null,
    issues,
    readyToSend: issues.length === 0,
    activeSequences,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findMailbox(actor: Pick<Actor, "organizationId">, id: string): Promise<MailboxRow> {
  const [row] = await db
    .select()
    .from(schema.mailbox)
    .where(and(eq(schema.mailbox.id, id), eq(schema.mailbox.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("Mailbox not found.");
  return row;
}

async function view(actor: Actor, row: MailboxRow): Promise<MailboxView> {
  const counts = await activeSequenceCounts(actor.organizationId, [row.id]);
  return toView(row, await sentTodayCount(row), counts.get(row.id) ?? 0);
}

/* -------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* -------------------------------------------------------------------------- */

export async function listMailboxes(actor: Actor): Promise<MailboxView[]> {
  const rows = await db
    .select()
    .from(schema.mailbox)
    .where(eq(schema.mailbox.organizationId, actor.organizationId))
    .orderBy(asc(schema.mailbox.email));
  const [counts, sent] = await Promise.all([
    activeSequenceCounts(
      actor.organizationId,
      rows.map((r) => r.id),
    ),
    sentTodayCounts(actor.organizationId),
  ]);
  return rows.map((r) => toView(r, sent.get(r.id) ?? 0, counts.get(r.id) ?? 0));
}

export async function getMailbox(actor: Actor, id: string): Promise<MailboxView> {
  return view(actor, await findMailbox(actor, id));
}

async function assertUniqueEmail(actor: Actor, email: string, exceptId?: string) {
  const where = [eq(schema.mailbox.organizationId, actor.organizationId), eq(schema.mailbox.email, email)];
  if (exceptId) where.push(ne(schema.mailbox.id, exceptId));
  const [row] = await db
    .select({ id: schema.mailbox.id })
    .from(schema.mailbox)
    .where(and(...where))
    .limit(1);
  if (row) {
    throw new HttpError(422, "This mailbox is already connected.", [{ path: "email", message: "Already connected." }]);
  }
}

export async function createMailbox(actor: Actor, input: unknown): Promise<MailboxView> {
  const data = createMailboxSchema.parse(input);
  const email = data.email.toLowerCase();
  await assertUniqueEmail(actor, email);
  const { smtpPassword, ...rest } = data;
  const [row] = await db
    .insert(schema.mailbox)
    .values({
      ...rest,
      email,
      smtpPort: rest.smtpPort ?? null,
      smtpPasswordEnc: smtpPassword ? encryptSecret(smtpPassword) : null,
      organizationId: actor.organizationId,
      userId: actor.userId,
      // New mailboxes start their ramp-up now (used when the gradual sending policy is on).
      warmupStartedAt: new Date(),
    })
    .returning();
  await audit(actor, "mailbox.create", "mailbox", row.id, { email: row.email, provider: row.provider });
  return view(actor, row);
}

export async function updateMailbox(actor: Actor, id: string, input: unknown): Promise<MailboxView> {
  const row = await findMailbox(actor, id);
  const data = updateMailboxSchema.parse(input);
  const { smtpPassword, ...rest } = data;
  const patch: Partial<typeof schema.mailbox.$inferInsert> = { ...rest };
  if (rest.email !== undefined) {
    patch.email = rest.email.toLowerCase();
    await assertUniqueEmail(actor, patch.email, row.id);
  }
  if (smtpPassword !== undefined) patch.smtpPasswordEnc = smtpPassword ? encryptSecret(smtpPassword) : null;

  const next = { ...row, ...patch };
  const counts = await activeSequenceCounts(actor.organizationId, [row.id]);
  if ((counts.get(row.id) ?? 0) > 0) {
    const issues = mailboxIssues(next);
    if (issues.length) {
      throw new HttpError(422, `Active sequences send from this mailbox. ${issues[0]}`, [
        { path: "mailbox", message: issues.join(" ") },
      ]);
    }
  }
  if (Object.keys(patch).length === 0) return view(actor, row);
  const [updated] = await db
    .update(schema.mailbox)
    .set(patch)
    .where(and(eq(schema.mailbox.id, row.id), eq(schema.mailbox.organizationId, actor.organizationId)))
    .returning();
  await audit(actor, "mailbox.update", "mailbox", row.id, {
    fields: Object.keys(data).map((k) => (k === "smtpPassword" ? "smtpPassword (changed)" : k)),
  });
  return view(actor, updated);
}

export async function deleteMailbox(actor: Actor, id: string): Promise<void> {
  const row = await findMailbox(actor, id);
  const counts = await activeSequenceCounts(actor.organizationId, [row.id]);
  if ((counts.get(row.id) ?? 0) > 0) {
    throw conflict("Active sequences send from this mailbox. Pause them or pick another mailbox first.");
  }
  await db
    .delete(schema.mailbox)
    .where(and(eq(schema.mailbox.id, row.id), eq(schema.mailbox.organizationId, actor.organizationId)));
  await audit(actor, "mailbox.delete", "mailbox", row.id, { email: row.email });
}

/* -------------------------------------------------------------------------- */
/* SMTP                                                                       */
/* -------------------------------------------------------------------------- */

/** Nodemailer transport for a mailbox, or null when its SMTP settings are incomplete. */
export function mailboxTransport(row: MailboxRow, opts: { timeoutMs?: number } = {}): Transporter | null {
  if (!row.smtpHost) return null;
  const password = row.smtpPasswordEnc ? decryptSecret(row.smtpPasswordEnc) : null;
  const port = row.smtpPort ?? (row.smtpSecure === "ssl" ? 465 : 587);
  const timeout = opts.timeoutMs ?? 20_000;
  return nodemailer.createTransport({
    host: row.smtpHost,
    port,
    secure: row.smtpSecure === "ssl",
    requireTLS: row.smtpSecure === "starttls",
    ignoreTLS: row.smtpSecure === "none",
    auth: row.smtpUser ? { user: row.smtpUser, pass: password ?? "" } : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  });
}

/** A plain-language reason for an SMTP failure. Never includes credentials. */
export function smtpErrorMessage(error: unknown, row: Pick<MailboxRow, "smtpHost" | "smtpPort">): string {
  const e: { code?: string; responseCode?: number } =
    typeof error === "object" && error !== null ? (error as { code?: string; responseCode?: number }) : {};
  const where = `${row.smtpHost ?? "the server"}${row.smtpPort ? `:${row.smtpPort}` : ""}`;
  switch (e.code) {
    case "ECONNREFUSED":
      return `Couldn't connect to ${where}. Check the host and port.`;
    case "ENOTFOUND":
    case "EDNS":
      return `Couldn't find the server ${row.smtpHost ?? ""}. Check the host name.`;
    case "ETIMEDOUT":
    case "ETIMEOUT":
    case "ECONNECTION":
      return `Connecting to ${where} timed out or was dropped. Check the host, port and security setting.`;
    case "EAUTH":
      return "The server rejected the username or password.";
    case "ETLS":
    case "ESOCKET":
      return "The secure connection failed. Check the security setting (SSL, STARTTLS or none) for this port.";
    case "EENVELOPE":
      return "The server refused the sender or recipient address.";
    case "EMESSAGE":
      return "The server refused the message.";
    default:
      if (e.responseCode && e.responseCode >= 500) return `The server refused the message (code ${e.responseCode}).`;
      if (e.responseCode && e.responseCode >= 400) return `The server deferred the message (code ${e.responseCode}).`;
      return "Sending failed for an unknown reason. Check the SMTP settings.";
  }
}

export async function testMailbox(actor: Actor, id: string): Promise<{ ok: boolean; message: string }> {
  const row = await findMailbox(actor, id);
  const transport = mailboxTransport(row, { timeoutMs: 10_000 });
  if (!transport) return { ok: false, message: "Add an SMTP host first." };
  if (row.smtpUser && row.smtpPasswordEnc && decryptSecret(row.smtpPasswordEnc) === null) {
    return { ok: false, message: "The stored password can't be read. Enter it again." };
  }
  try {
    await transport.verify();
    await audit(actor, "mailbox.test", "mailbox", row.id, { ok: true });
    return { ok: true, message: `Connected to ${row.smtpHost}${row.smtpUser ? " and signed in" : ""}.` };
  } catch (error) {
    const message = smtpErrorMessage(error, row);
    log.info("mailbox test failed", {
      component: "mailboxes",
      mailboxId: row.id,
      code: (error as { code?: string }).code,
    });
    await audit(actor, "mailbox.test", "mailbox", row.id, { ok: false });
    return { ok: false, message };
  } finally {
    transport.close();
  }
}
