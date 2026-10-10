import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, notInArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";

/* -------------------------------------------------------------------------- */
/* Input schemas                                                              */
/* -------------------------------------------------------------------------- */

const text = z.string().trim().max(200);

export const contactFiltersSchema = z
  .object({
    q: text.optional(),
    stage: z.enum(schema.contact.stage.enumValues).optional(),
    emailStatus: z.enum(schema.contact.emailStatus.enumValues).optional(),
    country: text.optional(),
    seniority: z.enum(schema.contact.seniority.enumValues).optional(),
  })
  .strict();

export const companyFiltersSchema = z
  .object({
    q: text.optional(),
    industry: text.optional(),
    country: text.optional(),
    employeeMin: z.number().int().min(0).optional(),
    employeeMax: z.number().int().min(0).optional(),
  })
  .strict();

export type ContactFilters = z.infer<typeof contactFiltersSchema>;
export type CompanyFilters = z.infer<typeof companyFiltersSchema>;
export type ListEntityType = "contact" | "company";

export const createListSchema = z
  .object({
    name: z.string().trim().min(1, "Name the list.").max(120),
    entityType: z.enum(["contact", "company"]),
    kind: z.enum(["static", "dynamic"]).default("static"),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "dynamic") {
      const parsed = (value.entityType === "contact" ? contactFiltersSchema : companyFiltersSchema).safeParse(
        value.filters ?? {},
      );
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: "custom", path: ["filters", ...issue.path.map(String)], message: issue.message });
        }
      }
    } else if (value.filters && Object.keys(value.filters).length > 0) {
      ctx.addIssue({ code: "custom", path: ["filters"], message: "Only dynamic lists have filters." });
    }
  });

export const updateListSchema = z
  .object({
    name: z.string().trim().min(1, "Name the list.").max(120).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const entityIdsSchema = z.object({
  listId: z.string().min(1).max(100),
  entityIds: z.array(z.string().min(1).max(100)).min(1, "Pass at least one id.").max(1000),
});

/* -------------------------------------------------------------------------- */
/* Output shapes                                                              */
/* -------------------------------------------------------------------------- */

export interface ListView {
  id: string;
  name: string;
  entityType: ListEntityType;
  kind: "static" | "dynamic";
  filters: Record<string, unknown> | null;
  memberCount: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactMember {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  emailStatus: string;
  stage: string;
  country: string | null;
  companyName: string | null;
  addedAt: string | null;
}

export interface CompanyMember {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  stage: string;
  addedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Filter semantics shared with dynamic lists                                 */
/* -------------------------------------------------------------------------- */

function like(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function contactConditions(organizationId: string, filters: ContactFilters): SQL[] {
  const c = schema.contact;
  const where: SQL[] = [eq(c.organizationId, organizationId)];
  if (filters.q) {
    const pattern = like(filters.q);
    const match = or(
      ilike(c.firstName, pattern),
      ilike(c.lastName, pattern),
      ilike(c.email, pattern),
      ilike(c.title, pattern),
      sql`(coalesce(${c.firstName}, '') || ' ' || coalesce(${c.lastName}, '')) ilike ${pattern}`,
    );
    if (match) where.push(match);
  }
  if (filters.stage) where.push(eq(c.stage, filters.stage));
  if (filters.emailStatus) where.push(eq(c.emailStatus, filters.emailStatus));
  if (filters.country) where.push(ilike(c.country, filters.country));
  if (filters.seniority) where.push(eq(c.seniority, filters.seniority));
  return where;
}

export function companyConditions(organizationId: string, filters: CompanyFilters): SQL[] {
  const c = schema.company;
  const where: SQL[] = [eq(c.organizationId, organizationId)];
  if (filters.q) {
    const pattern = like(filters.q);
    const match = or(ilike(c.name, pattern), ilike(c.domain, pattern));
    if (match) where.push(match);
  }
  if (filters.industry) where.push(ilike(c.industry, filters.industry));
  if (filters.country) where.push(ilike(c.country, filters.country));
  if (filters.employeeMin !== undefined) where.push(gte(c.employeeCount, filters.employeeMin));
  if (filters.employeeMax !== undefined) where.push(lte(c.employeeCount, filters.employeeMax));
  return where;
}

function parseFilters(entityType: ListEntityType, filters: Record<string, unknown> | null) {
  return entityType === "contact"
    ? { entityType, filters: contactFiltersSchema.catch({}).parse(filters ?? {}) }
    : { entityType, filters: companyFiltersSchema.catch({}).parse(filters ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

type ListRow = typeof schema.list.$inferSelect;

export async function findList(actor: Actor, id: string): Promise<ListRow> {
  const [row] = await db
    .select()
    .from(schema.list)
    .where(and(eq(schema.list.id, id), eq(schema.list.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("List not found.");
  return row;
}

async function memberCount(row: ListRow): Promise<number> {
  if (row.kind === "dynamic") {
    const parsed = parseFilters(row.entityType, row.filters);
    if (parsed.entityType === "contact") {
      const [r] = await db
        .select({ n: count() })
        .from(schema.contact)
        .where(and(...contactConditions(row.organizationId, parsed.filters)));
      return r?.n ?? 0;
    }
    const [r] = await db
      .select({ n: count() })
      .from(schema.company)
      .where(and(...companyConditions(row.organizationId, parsed.filters)));
    return r?.n ?? 0;
  }
  const table = row.entityType === "contact" ? schema.contact : schema.company;
  const [r] = await db
    .select({ n: count() })
    .from(schema.listMember)
    .innerJoin(table, and(eq(table.id, schema.listMember.entityId), eq(table.organizationId, row.organizationId)))
    .where(eq(schema.listMember.listId, row.id));
  return r?.n ?? 0;
}

async function toView(row: ListRow): Promise<ListView> {
  return {
    id: row.id,
    name: row.name,
    entityType: row.entityType,
    kind: row.kind,
    filters: row.filters ?? null,
    memberCount: await memberCount(row),
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listLists(actor: Actor, opts: { entityType?: ListEntityType } = {}): Promise<ListView[]> {
  const where: SQL[] = [eq(schema.list.organizationId, actor.organizationId)];
  if (opts.entityType) where.push(eq(schema.list.entityType, opts.entityType));
  const rows = await db
    .select()
    .from(schema.list)
    .where(and(...where))
    .orderBy(desc(schema.list.updatedAt));
  return Promise.all(rows.map(toView));
}

export async function getList(actor: Actor, id: string): Promise<ListView> {
  return toView(await findList(actor, id));
}

async function assertUniqueName(actor: Actor, name: string, entityType: ListEntityType, exceptId?: string) {
  const rows = await db
    .select({ id: schema.list.id })
    .from(schema.list)
    .where(
      and(
        eq(schema.list.organizationId, actor.organizationId),
        eq(schema.list.entityType, entityType),
        sql`lower(${schema.list.name}) = lower(${name})`,
      ),
    );
  if (rows.some((r) => r.id !== exceptId)) {
    throw new HttpError(422, "A list with this name already exists.", [
      { path: "name", message: "Pick a different name." },
    ]);
  }
}

export async function createList(actor: Actor, input: unknown): Promise<ListView> {
  const data = createListSchema.parse(input);
  await assertUniqueName(actor, data.name, data.entityType);
  const filters = data.kind === "dynamic" ? parseFilters(data.entityType, data.filters ?? {}).filters : null;
  const [row] = await db
    .insert(schema.list)
    .values({
      organizationId: actor.organizationId,
      name: data.name,
      entityType: data.entityType,
      kind: data.kind,
      filters,
      createdById: actor.userId,
    })
    .returning();
  await audit(actor, "list.create", "list", row.id, { name: row.name, entityType: row.entityType, kind: row.kind });
  return toView(row);
}

export async function updateList(actor: Actor, id: string, input: unknown): Promise<ListView> {
  const row = await findList(actor, id);
  const data = updateListSchema.parse(input);
  const patch: Partial<typeof schema.list.$inferInsert> = {};
  if (data.name !== undefined) {
    await assertUniqueName(actor, data.name, row.entityType, row.id);
    patch.name = data.name;
  }
  if (data.filters !== undefined) {
    if (row.kind !== "dynamic") throw new HttpError(422, "Only dynamic lists have filters.");
    const schemaFor = row.entityType === "contact" ? contactFiltersSchema : companyFiltersSchema;
    patch.filters = schemaFor.parse(data.filters);
  }
  if (Object.keys(patch).length === 0) return toView(row);
  const [updated] = await db
    .update(schema.list)
    .set(patch)
    .where(and(eq(schema.list.id, row.id), eq(schema.list.organizationId, actor.organizationId)))
    .returning();
  await audit(actor, "list.update", "list", row.id, { fields: Object.keys(patch) });
  return toView(updated);
}

export async function deleteList(actor: Actor, id: string): Promise<void> {
  const row = await findList(actor, id);
  await db
    .delete(schema.list)
    .where(and(eq(schema.list.id, row.id), eq(schema.list.organizationId, actor.organizationId)));
  await audit(actor, "list.delete", "list", row.id, { name: row.name });
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

const contactColumns = {
  id: schema.contact.id,
  firstName: schema.contact.firstName,
  lastName: schema.contact.lastName,
  title: schema.contact.title,
  email: schema.contact.email,
  emailStatus: schema.contact.emailStatus,
  stage: schema.contact.stage,
  country: schema.contact.country,
  companyName: schema.company.name,
};

const companyColumns = {
  id: schema.company.id,
  name: schema.company.name,
  domain: schema.company.domain,
  industry: schema.company.industry,
  employeeCount: schema.company.employeeCount,
  country: schema.company.country,
  stage: schema.company.stage,
};

type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  emailStatus: string;
  stage: string;
  country: string | null;
  companyName: string | null;
  addedAt?: Date | null;
};

function contactMember(r: ContactRow): ContactMember {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Unnamed contact";
  return {
    id: r.id,
    name,
    firstName: r.firstName,
    lastName: r.lastName,
    title: r.title,
    email: r.email,
    emailStatus: r.emailStatus,
    stage: r.stage,
    country: r.country,
    companyName: r.companyName,
    addedAt: r.addedAt ? r.addedAt.toISOString() : null,
  };
}

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  stage: string;
  addedAt?: Date | null;
};

function companyMember(r: CompanyRow): CompanyMember {
  return { ...r, addedAt: r.addedAt ? r.addedAt.toISOString() : null };
}

export type MembersResult =
  | { entityType: "contact"; contacts: ContactMember[]; total: number }
  | { entityType: "company"; accounts: CompanyMember[]; total: number };

export async function listMembers(actor: Actor, id: string, page: Page, q?: string): Promise<MembersResult> {
  const row = await findList(actor, id);
  const org = actor.organizationId;

  if (row.kind === "dynamic") {
    const parsed = parseFilters(row.entityType, row.filters);
    if (parsed.entityType === "contact") {
      const where = and(...contactConditions(org, parsed.filters), ...(q ? contactConditions(org, { q }) : []));
      const [total] = await db.select({ n: count() }).from(schema.contact).where(where);
      const rows = await db
        .select(contactColumns)
        .from(schema.contact)
        .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
        .where(where)
        .orderBy(asc(schema.contact.lastName), asc(schema.contact.id))
        .limit(page.perPage)
        .offset(page.offset);
      return { entityType: "contact", contacts: rows.map(contactMember), total: total?.n ?? 0 };
    }
    const where = and(...companyConditions(org, parsed.filters), ...(q ? companyConditions(org, { q }) : []));
    const [total] = await db.select({ n: count() }).from(schema.company).where(where);
    const rows = await db
      .select(companyColumns)
      .from(schema.company)
      .where(where)
      .orderBy(asc(schema.company.name), asc(schema.company.id))
      .limit(page.perPage)
      .offset(page.offset);
    return { entityType: "company", accounts: rows.map(companyMember), total: total?.n ?? 0 };
  }

  if (row.entityType === "contact") {
    const where = and(eq(schema.listMember.listId, row.id), ...(q ? contactConditions(org, { q }) : []));
    const join = and(eq(schema.contact.id, schema.listMember.entityId), eq(schema.contact.organizationId, org));
    const [total] = await db
      .select({ n: count() })
      .from(schema.listMember)
      .innerJoin(schema.contact, join)
      .where(where);
    const rows = await db
      .select({ ...contactColumns, addedAt: schema.listMember.addedAt })
      .from(schema.listMember)
      .innerJoin(schema.contact, join)
      .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
      .where(where)
      .orderBy(desc(schema.listMember.addedAt), asc(schema.contact.id))
      .limit(page.perPage)
      .offset(page.offset);
    return { entityType: "contact", contacts: rows.map(contactMember), total: total?.n ?? 0 };
  }

  const where = and(eq(schema.listMember.listId, row.id), ...(q ? companyConditions(org, { q }) : []));
  const join = and(eq(schema.company.id, schema.listMember.entityId), eq(schema.company.organizationId, org));
  const [total] = await db.select({ n: count() }).from(schema.listMember).innerJoin(schema.company, join).where(where);
  const rows = await db
    .select({ ...companyColumns, addedAt: schema.listMember.addedAt })
    .from(schema.listMember)
    .innerJoin(schema.company, join)
    .where(where)
    .orderBy(desc(schema.listMember.addedAt), asc(schema.company.id))
    .limit(page.perPage)
    .offset(page.offset);
  return { entityType: "company", accounts: rows.map(companyMember), total: total?.n ?? 0 };
}

/** Ids from `ids` that exist in the actor's workspace as `entityType`. */
async function idsInScope(actor: Actor, entityType: ListEntityType, ids: string[]): Promise<Set<string>> {
  const table = entityType === "contact" ? schema.contact : schema.company;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, actor.organizationId), inArray(table.id, ids)));
  return new Set(rows.map((r) => r.id));
}

async function staticListFor(actor: Actor, listId: string): Promise<ListRow> {
  const row = await findList(actor, listId);
  if (row.kind === "dynamic") {
    throw new HttpError(422, "Dynamic lists update themselves from their filters. Edit the filters instead.");
  }
  return row;
}

export async function addMembers(
  actor: Actor,
  input: unknown,
): Promise<{ list: ListView; added: number; alreadyMembers: number }> {
  const { listId, entityIds } = entityIdsSchema.parse(input);
  const row = await staticListFor(actor, listId);
  const unique = [...new Set(entityIds)];
  const found = await idsInScope(actor, row.entityType, unique);
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) {
    throw new HttpError(404, `Some ${row.entityType === "contact" ? "contacts" : "companies"} weren't found.`, {
      missingIds: missing,
    });
  }
  const inserted = await db
    .insert(schema.listMember)
    .values(unique.map((entityId) => ({ listId: row.id, entityId })))
    .onConflictDoNothing()
    .returning({ entityId: schema.listMember.entityId });
  await db.update(schema.list).set({ updatedAt: new Date() }).where(eq(schema.list.id, row.id));
  await audit(actor, "list.members.add", "list", row.id, { count: inserted.length });
  return { list: await toView(row), added: inserted.length, alreadyMembers: unique.length - inserted.length };
}

export async function removeMembers(actor: Actor, input: unknown): Promise<{ list: ListView; removed: number }> {
  const { listId, entityIds } = entityIdsSchema.parse(input);
  const row = await staticListFor(actor, listId);
  const unique = [...new Set(entityIds)];
  const found = await idsInScope(actor, row.entityType, unique);
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) {
    throw new HttpError(404, `Some ${row.entityType === "contact" ? "contacts" : "companies"} weren't found.`, {
      missingIds: missing,
    });
  }
  const removed = await db
    .delete(schema.listMember)
    .where(and(eq(schema.listMember.listId, row.id), inArray(schema.listMember.entityId, unique)))
    .returning({ entityId: schema.listMember.entityId });
  await db.update(schema.list).set({ updatedAt: new Date() }).where(eq(schema.list.id, row.id));
  await audit(actor, "list.members.remove", "list", row.id, { count: removed.length });
  return { list: await toView(row), removed: removed.length };
}

/* -------------------------------------------------------------------------- */
/* Pickers: search records to add to a list or a sequence                     */
/* -------------------------------------------------------------------------- */

export async function searchContacts(
  actor: Actor,
  q: string,
  opts: { excludeIds?: string[]; limit?: number } = {},
): Promise<ContactMember[]> {
  const where = contactConditions(actor.organizationId, { q: q.trim() || undefined });
  if (opts.excludeIds?.length) where.push(notInArray(schema.contact.id, opts.excludeIds));
  const rows = await db
    .select(contactColumns)
    .from(schema.contact)
    .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
    .where(and(...where))
    .orderBy(asc(schema.contact.lastName), asc(schema.contact.id))
    .limit(opts.limit ?? 20);
  return rows.map(contactMember);
}

export async function searchCompanies(
  actor: Actor,
  q: string,
  opts: { excludeIds?: string[]; limit?: number } = {},
): Promise<CompanyMember[]> {
  const where = companyConditions(actor.organizationId, { q: q.trim() || undefined });
  if (opts.excludeIds?.length) where.push(notInArray(schema.company.id, opts.excludeIds));
  const rows = await db
    .select(companyColumns)
    .from(schema.company)
    .where(and(...where))
    .orderBy(asc(schema.company.name), asc(schema.company.id))
    .limit(opts.limit ?? 20);
  return rows.map(companyMember);
}

/** Records not yet in a static list that match `q`, for the "add members" picker. */
export async function listCandidates(
  actor: Actor,
  id: string,
  q: string,
): Promise<
  { entityType: "contact"; contacts: ContactMember[] } | { entityType: "company"; accounts: CompanyMember[] }
> {
  const row = await staticListFor(actor, id);
  const current = await db
    .select({ id: schema.listMember.entityId })
    .from(schema.listMember)
    .where(eq(schema.listMember.listId, row.id));
  const excludeIds = current.map((r) => r.id);
  if (row.entityType === "contact") {
    return { entityType: "contact", contacts: await searchContacts(actor, q, { excludeIds }) };
  }
  return { entityType: "company", accounts: await searchCompanies(actor, q, { excludeIds }) };
}
