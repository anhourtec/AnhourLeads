import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";

/** 422 for a body field that points at something outside the workspace (or that doesn't exist). */
export function invalidReference(path: string, message: string): HttpError {
  return new HttpError(422, "Some fields are invalid.", [{ path, message }]);
}

/** An ISO date or date-time string, parsed to a Date. */
export const dateInput = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Use an ISO date, e.g. 2026-10-31." })
  .transform((value) => new Date(value));

/** Optional nullable id field. */
export const refId = z.string().trim().min(1).max(64);

export async function assertWorkspaceMember(actor: Actor, userId: string, path: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) throw invalidReference(path, "Pick someone who is a member of this workspace.");
}

export async function contactInScope(actor: Actor, contactId: string, path: string) {
  const [row] = await db
    .select({ id: schema.contact.id, companyId: schema.contact.companyId })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), eq(schema.contact.id, contactId)))
    .limit(1);
  if (!row) throw invalidReference(path, "Contact not found.");
  return row;
}

export async function contactsInScope(actor: Actor, contactIds: string[], path: string) {
  const rows = await db
    .select({ id: schema.contact.id, companyId: schema.contact.companyId })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), inArray(schema.contact.id, contactIds)));
  const found = new Set(rows.map((r) => r.id));
  const missing = contactIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new HttpError(
      422,
      "Some fields are invalid.",
      missing.map((id) => ({ path, message: `Contact ${id} not found.` })),
    );
  }
  return rows;
}

export async function assertCompanyInScope(actor: Actor, companyId: string, path: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(and(eq(schema.company.organizationId, actor.organizationId), eq(schema.company.id, companyId)))
    .limit(1);
  if (!row) throw invalidReference(path, "Company not found.");
}
