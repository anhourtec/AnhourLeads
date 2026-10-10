import "server-only";

import { and, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { SUPPRESSION_REASONS, type SuppressionReason } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";

export type SuppressionKind = "email" | "domain";

const EMAIL_RE = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normaliseEmail(value: string): string | null {
  const v = value.trim().toLowerCase();
  return v.length <= 320 && EMAIL_RE.test(v) ? v : null;
}

/**
 * Normalise a do-not-contact entry: lowercase, trimmed. Anything with an @ is an email; anything
 * else is a domain (a pasted URL, a leading "@" or "www." are stripped). Returns null when invalid.
 */
export function normaliseEntry(raw: string, kind?: SuppressionKind): { kind: SuppressionKind; value: string } | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const asEmail = kind !== "domain" && v.includes("@") && !v.startsWith("@");
  if (asEmail || kind === "email") {
    const email = normaliseEmail(v);
    return email ? { kind: "email", value: email } : null;
  }
  const domain = v
    .replace(/^@/, "")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  return DOMAIN_RE.test(domain) ? { kind: "domain", value: domain } : null;
}

/** Reasons a person may choose; "erasure_request" is set only by the erasure endpoint. */
const MANUAL_REASONS = SUPPRESSION_REASONS.filter((r) => r !== "erasure_request") as [
  Exclude<SuppressionReason, "erasure_request">,
  ...Exclude<SuppressionReason, "erasure_request">[],
];

export const suppressionCreateSchema = z.object({
  value: z.string().trim().min(1, "Enter an email address or a domain.").max(320),
  kind: z.enum(["email", "domain"]).optional(),
  reason: z.enum(MANUAL_REASONS).default("manual"),
  note: z.string().trim().max(500).optional(),
});

export const suppressionBulkSchema = z
  .object({
    /** One entry per line (or pass `values`). */
    text: z.string().max(400_000).optional(),
    values: z.array(z.string().max(320)).max(1000).optional(),
    reason: z.enum(MANUAL_REASONS).default("manual"),
    note: z.string().trim().max(500).optional(),
  })
  .transform((v, ctx) => {
    const lines = (v.values ?? (v.text ?? "").split(/\r?\n|,|;/)).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "Add at least one email address or domain." });
      return z.NEVER;
    }
    if (lines.length > 1000) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "Add at most 1,000 entries at a time." });
      return z.NEVER;
    }
    return { lines, reason: v.reason, note: v.note };
  });

export const suppressionListSchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(["email", "domain"]).optional(),
  reason: z.enum(SUPPRESSION_REASONS).optional(),
});

export interface SuppressionDto {
  id: string;
  kind: SuppressionKind;
  value: string;
  reason: SuppressionReason;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

const columns = {
  id: schema.suppression.id,
  kind: schema.suppression.kind,
  value: schema.suppression.value,
  reason: schema.suppression.reason,
  note: schema.suppression.note,
  createdAt: schema.suppression.createdAt,
  createdById: schema.suppression.createdById,
  createdByName: schema.user.name,
};

type Row = Awaited<ReturnType<typeof baseQuery>>[number];

function toDto(row: Row): SuppressionDto {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    reason: row.reason,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdById && row.createdByName ? { id: row.createdById, name: row.createdByName } : null,
  };
}

function baseQuery() {
  return db
    .select(columns)
    .from(schema.suppression)
    .leftJoin(schema.user, eq(schema.user.id, schema.suppression.createdById));
}

export async function listSuppressions(actor: Actor, input: z.infer<typeof suppressionListSchema>, page: Page) {
  const where: SQL[] = [eq(schema.suppression.organizationId, actor.organizationId)];
  if (input.q) {
    const term = `%${input.q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(ilike(schema.suppression.value, term), ilike(schema.suppression.note, term));
    if (match) where.push(match);
  }
  if (input.kind) where.push(eq(schema.suppression.kind, input.kind));
  if (input.reason) where.push(eq(schema.suppression.reason, input.reason));
  const condition = and(...where);
  const [rows, [{ count }]] = await Promise.all([
    baseQuery()
      .where(condition)
      .orderBy(desc(schema.suppression.createdAt), desc(schema.suppression.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.suppression).where(condition),
  ]);
  return { suppressions: rows.map(toDto), total: count };
}

async function getSuppression(actor: Actor, id: string): Promise<SuppressionDto> {
  const [row] = await baseQuery()
    .where(and(eq(schema.suppression.organizationId, actor.organizationId), eq(schema.suppression.id, id)))
    .limit(1);
  if (!row) throw notFound("Entry not found.");
  return toDto(row);
}

/**
 * Apply a suppression to existing records: matching contacts move to do_not_contact and their
 * active or paused enrollments stop ("unsubscribed" for unsubscribes, otherwise "removed").
 */
export async function applySuppression(
  organizationId: string,
  entries: { kind: SuppressionKind; value: string }[],
  reason: SuppressionReason,
): Promise<{ contacts: number; enrollments: number }> {
  if (!entries.length) return { contacts: 0, enrollments: 0 };
  const emails = entries.filter((e) => e.kind === "email").map((e) => e.value);
  const domains = entries.filter((e) => e.kind === "domain").map((e) => e.value);
  const matchers: SQL[] = [];
  if (emails.length) matchers.push(inArray(sql`lower(${schema.contact.email})`, emails));
  if (domains.length) matchers.push(inArray(sql`lower(split_part(${schema.contact.email}, '@', 2))`, domains));
  const match = or(...matchers);

  const contacts = await db
    .update(schema.contact)
    .set({ stage: "do_not_contact" })
    .where(and(eq(schema.contact.organizationId, organizationId), match))
    .returning({ id: schema.contact.id });
  if (!contacts.length) return { contacts: 0, enrollments: 0 };

  const enrollments = await db
    .update(schema.enrollment)
    .set({ status: reason === "unsubscribed" ? "unsubscribed" : "removed", nextRunAt: null })
    .where(
      and(
        eq(schema.enrollment.organizationId, organizationId),
        inArray(
          schema.enrollment.contactId,
          contacts.map((c) => c.id),
        ),
        inArray(schema.enrollment.status, ["active", "paused"]),
      ),
    )
    .returning({ id: schema.enrollment.id });
  return { contacts: contacts.length, enrollments: enrollments.length };
}

export interface CreateResult {
  suppression: SuppressionDto;
  created: boolean;
  affected: { contacts: number; enrollments: number };
}

export async function createSuppression(
  actor: Actor,
  input: z.infer<typeof suppressionCreateSchema>,
): Promise<CreateResult> {
  const entry = normaliseEntry(input.value, input.kind);
  if (!entry) {
    throw new HttpError(422, "Some fields are invalid.", [
      { path: "value", message: "Enter a valid email address or domain." },
    ]);
  }
  const inserted = await db
    .insert(schema.suppression)
    .values({
      organizationId: actor.organizationId,
      kind: entry.kind,
      value: entry.value,
      reason: input.reason,
      note: input.note || null,
      createdById: actor.userId,
    })
    .onConflictDoNothing()
    .returning({ id: schema.suppression.id });

  if (!inserted.length) {
    const [existing] = await db
      .select({ id: schema.suppression.id })
      .from(schema.suppression)
      .where(
        and(
          eq(schema.suppression.organizationId, actor.organizationId),
          eq(schema.suppression.kind, entry.kind),
          eq(schema.suppression.value, entry.value),
        ),
      )
      .limit(1);
    return {
      suppression: await getSuppression(actor, existing.id),
      created: false,
      affected: { contacts: 0, enrollments: 0 },
    };
  }
  const affected = await applySuppression(actor.organizationId, [entry], input.reason);
  await audit(actor, "suppression.create", "suppression", inserted[0].id, {
    kind: entry.kind,
    value: entry.value,
    reason: input.reason,
    ...affected,
  });
  return { suppression: await getSuppression(actor, inserted[0].id), created: true, affected };
}

export async function bulkCreateSuppressions(actor: Actor, input: z.infer<typeof suppressionBulkSchema>) {
  const invalid: { line: string; error: string }[] = [];
  const unique = new Map<string, { kind: SuppressionKind; value: string }>();
  for (const line of input.lines) {
    const entry = normaliseEntry(line);
    if (!entry) invalid.push({ line, error: "Not a valid email address or domain." });
    else unique.set(`${entry.kind}:${entry.value}`, entry);
  }
  const entries = [...unique.values()];
  const inserted = entries.length
    ? await db
        .insert(schema.suppression)
        .values(
          entries.map((e) => ({
            organizationId: actor.organizationId,
            kind: e.kind,
            value: e.value,
            reason: input.reason,
            note: input.note || null,
            createdById: actor.userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ kind: schema.suppression.kind, value: schema.suppression.value })
    : [];
  const affected = await applySuppression(actor.organizationId, inserted, input.reason);
  if (inserted.length) {
    await audit(actor, "suppression.bulk_create", "suppression", null, {
      created: inserted.length,
      reason: input.reason,
      ...affected,
    });
  }
  return { created: inserted.length, existing: entries.length - inserted.length, invalid, affected };
}

export async function deleteSuppression(actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(schema.suppression)
    .where(and(eq(schema.suppression.organizationId, actor.organizationId), eq(schema.suppression.id, id)))
    .returning({ kind: schema.suppression.kind, value: schema.suppression.value });
  if (!deleted.length) throw notFound("Entry not found.");
  await audit(actor, "suppression.delete", "suppression", id, { kind: deleted[0].kind, value: deleted[0].value });
}

/** Entries that block an address: the exact email or its domain. */
export async function findSuppressions(organizationId: string, email: string): Promise<SuppressionDto[]> {
  const domain = email.split("@")[1] ?? "";
  const rows = await baseQuery().where(
    and(
      eq(schema.suppression.organizationId, organizationId),
      or(
        and(eq(schema.suppression.kind, "email"), eq(schema.suppression.value, email)),
        and(eq(schema.suppression.kind, "domain"), eq(schema.suppression.value, domain)),
      ),
    ),
  );
  return rows.map(toDto);
}

export async function checkSuppression(actor: Actor, rawEmail: string) {
  const email = normaliseEmail(rawEmail);
  if (!email) {
    throw new HttpError(422, "Some fields are invalid.", [{ path: "email", message: "Enter a valid email address." }]);
  }
  const matches = await findSuppressions(actor.organizationId, email);
  return { email, suppressed: matches.length > 0, matches };
}
