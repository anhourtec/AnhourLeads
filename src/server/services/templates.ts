import "server-only";

import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";

import { audit } from "./audit";

/**
 * Email templates and snippets. Everyone can read shared ones (and their own private ones); members
 * create and edit; deleting needs `template:delete` (manager and up) or being the owner.
 */

const name = z.string().trim().min(1, "Name it.").max(120);
const body = z
  .string()
  .max(20_000)
  .refine((v) => v.trim().length > 0, "Write the body.");
const subject = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => v || null);

export const createTemplateSchema = z.object({ name, subject, body, shared: z.boolean().default(true) }).strict();
export const updateTemplateSchema = z
  .object({ name, subject, body, shared: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

export const createSnippetSchema = z.object({ name, body, shared: z.boolean().default(true) }).strict();
export const updateSnippetSchema = z
  .object({ name, body, shared: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

export const listQuerySchema = z.object({ q: z.string().trim().max(200).optional() });

type TemplateRow = typeof schema.emailTemplate.$inferSelect;
type SnippetRow = typeof schema.snippet.$inferSelect;

export interface TemplateView {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  shared: boolean;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetView {
  id: string;
  name: string;
  body: string;
  shared: boolean;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
}

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Visible: shared ones plus the actor's own. */
function visible(table: typeof schema.emailTemplate | typeof schema.snippet, actor: Actor): SQL {
  const own = actor.userId ? eq(table.ownerId, actor.userId) : undefined;
  return own ? (or(eq(table.shared, true), own) as SQL) : eq(table.shared, true);
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export async function listTemplates(actor: Actor, input: unknown = {}): Promise<TemplateView[]> {
  const { q } = listQuerySchema.parse(input ?? {});
  const t = schema.emailTemplate;
  const where: SQL[] = [eq(t.organizationId, actor.organizationId), visible(t, actor)];
  if (q) where.push(or(ilike(t.name, escapeLike(q)), ilike(t.subject, escapeLike(q))) as SQL);
  const rows = await db
    .select({ row: t, ownerName: schema.user.name })
    .from(t)
    .leftJoin(schema.user, eq(schema.user.id, t.ownerId))
    .where(and(...where))
    .orderBy(desc(t.updatedAt), asc(t.id))
    .limit(500);
  return rows.map(({ row, ownerName }) => templateView(row, ownerName));
}

function templateView(row: TemplateRow, ownerName: string | null): TemplateView {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    shared: row.shared,
    ownerId: row.ownerId,
    ownerName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findTemplate(actor: Actor, id: string): Promise<TemplateRow> {
  const t = schema.emailTemplate;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.id, id), eq(t.organizationId, actor.organizationId), visible(t, actor)))
    .limit(1);
  if (!row) throw notFound("Template not found.");
  return row;
}

export async function getTemplate(actor: Actor, id: string): Promise<TemplateView> {
  const row = await findTemplate(actor, id);
  const [owner] = row.ownerId
    ? await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, row.ownerId)).limit(1)
    : [];
  return templateView(row, owner?.name ?? null);
}

export async function createTemplate(actor: Actor, input: unknown): Promise<TemplateView> {
  const data = createTemplateSchema.parse(input);
  const [row] = await db
    .insert(schema.emailTemplate)
    .values({ organizationId: actor.organizationId, ownerId: actor.userId, ...data })
    .returning({ id: schema.emailTemplate.id });
  await audit(actor, "template.create", "email_template", row.id, { name: data.name });
  return getTemplate(actor, row.id);
}

export async function updateTemplate(actor: Actor, id: string, input: unknown): Promise<TemplateView> {
  const row = await findTemplate(actor, id);
  const data = updateTemplateSchema.parse(input);
  await db.update(schema.emailTemplate).set(data).where(eq(schema.emailTemplate.id, row.id));
  await audit(actor, "template.update", "email_template", row.id, { fields: Object.keys(data) });
  return getTemplate(actor, row.id);
}

function assertCanDelete(actor: Actor, ownerId: string | null) {
  if (can(actor.role, "template:delete")) return;
  if (actor.userId && ownerId === actor.userId) return;
  throw forbidden("Only the owner or a manager can delete this.");
}

export async function deleteTemplate(actor: Actor, id: string): Promise<void> {
  const row = await findTemplate(actor, id);
  assertCanDelete(actor, row.ownerId);
  await db.delete(schema.emailTemplate).where(eq(schema.emailTemplate.id, row.id));
  await audit(actor, "template.delete", "email_template", row.id, { name: row.name });
}

/* -------------------------------------------------------------------------- */
/* Snippets                                                                   */
/* -------------------------------------------------------------------------- */

function snippetView(row: SnippetRow, ownerName: string | null): SnippetView {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    shared: row.shared,
    ownerId: row.ownerId,
    ownerName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSnippets(actor: Actor, input: unknown = {}): Promise<SnippetView[]> {
  const { q } = listQuerySchema.parse(input ?? {});
  const s = schema.snippet;
  const where: SQL[] = [eq(s.organizationId, actor.organizationId), visible(s, actor)];
  if (q) where.push(or(ilike(s.name, escapeLike(q)), ilike(s.body, escapeLike(q))) as SQL);
  const rows = await db
    .select({ row: s, ownerName: schema.user.name })
    .from(s)
    .leftJoin(schema.user, eq(schema.user.id, s.ownerId))
    .where(and(...where))
    .orderBy(asc(s.name), asc(s.id))
    .limit(500);
  return rows.map(({ row, ownerName }) => snippetView(row, ownerName));
}

async function findSnippet(actor: Actor, id: string): Promise<SnippetRow> {
  const s = schema.snippet;
  const [row] = await db
    .select()
    .from(s)
    .where(and(eq(s.id, id), eq(s.organizationId, actor.organizationId), visible(s, actor)))
    .limit(1);
  if (!row) throw notFound("Snippet not found.");
  return row;
}

export async function getSnippet(actor: Actor, id: string): Promise<SnippetView> {
  const row = await findSnippet(actor, id);
  const [owner] = row.ownerId
    ? await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, row.ownerId)).limit(1)
    : [];
  return snippetView(row, owner?.name ?? null);
}

export async function createSnippet(actor: Actor, input: unknown): Promise<SnippetView> {
  const data = createSnippetSchema.parse(input);
  const [row] = await db
    .insert(schema.snippet)
    .values({ organizationId: actor.organizationId, ownerId: actor.userId, ...data })
    .returning({ id: schema.snippet.id });
  await audit(actor, "snippet.create", "snippet", row.id, { name: data.name });
  return getSnippet(actor, row.id);
}

export async function updateSnippet(actor: Actor, id: string, input: unknown): Promise<SnippetView> {
  const row = await findSnippet(actor, id);
  const data = updateSnippetSchema.parse(input);
  await db.update(schema.snippet).set(data).where(eq(schema.snippet.id, row.id));
  await audit(actor, "snippet.update", "snippet", row.id, { fields: Object.keys(data) });
  return getSnippet(actor, row.id);
}

export async function deleteSnippet(actor: Actor, id: string): Promise<void> {
  const row = await findSnippet(actor, id);
  assertCanDelete(actor, row.ownerId);
  await db.delete(schema.snippet).where(eq(schema.snippet.id, row.id));
  await audit(actor, "snippet.delete", "snippet", row.id, { name: row.name });
}
