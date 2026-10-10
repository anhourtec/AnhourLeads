import "server-only";

import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  CONTACT_STAGE_LABELS,
  type ContactEmailStatus,
  type ContactStage,
  type Seniority,
} from "@/lib/records-vocabulary";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { conflict, HttpError, notFound } from "@/server/http/errors";
import { type Page, pagination } from "@/server/http/route";

import { audit } from "./audit";
import {
  assertCompany,
  assertList,
  assertMember,
  chunk,
  cleanupEntities,
  csvEnum,
  csvList,
  defaultOwner,
  EXPORT_MAX_ROWS,
  emailSchema,
  enumList,
  type ImportPayload,
  type ImportReport,
  type ImportRowError,
  idSchema,
  inList,
  likePattern,
  mapCsv,
  normalizeDomain,
  optionalBool,
  optionalInt,
  optionalText,
  provenanceFor,
  provenanceRows,
  recordProvenance,
  stringList,
  tagList,
  toCsv,
  unprocessable,
  writeSource,
} from "./records";

const { contact, company, user, suppression } = schema;

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

export const CONTACT_STAGES = contact.stage.enumValues;
export const SENIORITIES = contact.seniority.enumValues;
export const EMAIL_STATUSES = contact.emailStatus.enumValues;

// The client-side vocabulary must list exactly the column enums.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _vocabularyMatches: [
  Same<(typeof CONTACT_STAGES)[number], ContactStage>,
  Same<(typeof SENIORITIES)[number], Seniority>,
  Same<(typeof EMAIL_STATUSES)[number], ContactEmailStatus>,
] = [true, true, true];
void _vocabularyMatches;

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const contactFieldShape = {
  firstName: optionalText(100),
  lastName: optionalText(100),
  title: optionalText(200),
  seniority: z.enum(SENIORITIES).nullable().optional(),
  department: optionalText(100),
  email: emailSchema,
  phone: optionalText(50),
  linkedinUrl: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  timezone: optionalText(64),
  companyId: idSchema.nullable().optional(),
  ownerId: idSchema.nullable().optional(),
  stage: z.enum(CONTACT_STAGES).optional(),
  consentBasis: optionalText(100),
  tags: tagList.optional(),
};

const hasIdentity = (v: { firstName?: string | null; lastName?: string | null; email?: string | null }) =>
  [v.firstName, v.lastName, v.email].some(Boolean);

export const contactCreateSchema = z
  .object({ ...contactFieldShape, runDedupe: z.boolean().optional() })
  .refine(hasIdentity, { message: "Give the person a name or an email address.", path: ["email"] });
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export const contactUpdateSchema = z
  .object(contactFieldShape)
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

const contactSortFields = ["createdAt", "updatedAt", "name", "email", "title", "stage"] as const;

export const contactSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  seniority: enumList(SENIORITIES),
  department: stringList(),
  emailStatus: enumList(EMAIL_STATUSES),
  stage: enumList(CONTACT_STAGES),
  country: stringList(),
  tags: stringList(),
  companyId: idSchema.optional(),
  ownerId: idSchema.optional(),
  listId: idSchema.optional(),
  /** Company attribute filters (people search). */
  industry: stringList(),
  employeesMin: optionalInt(0, 10_000_000),
  employeesMax: optionalInt(0, 10_000_000),
  sortBy: z.enum(contactSortFields).optional(),
  sortAscending: optionalBool,
});
export type ContactSearch = z.infer<typeof contactSearchSchema>;

/** Apollo-style names accepted by `POST /mixed_people/search`, mapped onto our filters. */
export function fromApolloPeopleSearch(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const alias = (from: string, to: string) => {
    if (body[from] !== undefined && out[to] === undefined) out[to] = body[from];
    delete out[from];
  };
  alias("q_keywords", "q");
  alias("person_seniorities", "seniority");
  alias("contact_email_status", "emailStatus");
  alias("person_locations", "country");
  alias("contact_stage_ids", "stage");
  alias("contact_label_ids", "listId");
  alias("sort_ascending", "sortAscending");
  if (Array.isArray(body.person_titles) && out.title === undefined) out.title = body.person_titles.join(",");
  delete out.person_titles;
  if (Array.isArray(out.listId)) out.listId = out.listId[0];
  const ranges = body.organization_num_employees_ranges;
  if (Array.isArray(ranges) && typeof ranges[0] === "string") {
    const bounds = ranges.flatMap((r) => String(r).split(",").map(Number));
    if (bounds.every(Number.isFinite)) {
      out.employeesMin ??= Math.min(...bounds);
      out.employeesMax ??= Math.max(...bounds);
    }
  }
  delete out.organization_num_employees_ranges;
  if (Array.isArray(body.organization_ids) && typeof body.organization_ids[0] === "string") {
    out.companyId ??= body.organization_ids[0];
  }
  delete out.organization_ids;
  return out;
}

const idsSchema = z.array(idSchema).min(1, "Pass at least one contact id.").max(1000);

export const contactBulkUpdateSchema = z
  .object({
    contactIds: idsSchema,
    ownerId: idSchema.nullable().optional(),
    stage: z.enum(CONTACT_STAGES).optional(),
    companyId: idSchema.nullable().optional(),
    title: optionalText(200),
    seniority: z.enum(SENIORITIES).nullable().optional(),
    department: optionalText(100),
    city: optionalText(100),
    state: optionalText(100),
    country: optionalText(100),
    consentBasis: optionalText(100),
    tags: tagList.optional(),
  })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== "contactIds" && x !== undefined), {
    message: "Pass at least one field to update.",
  });

export const contactStagesSchema = z.object({ contactIds: idsSchema, stage: z.enum(CONTACT_STAGES) });
export const contactOwnersSchema = z.object({ contactIds: idsSchema, ownerId: idSchema.nullable() });
export const contactBulkDeleteSchema = z.object({ contactIds: idsSchema });
export const contactBulkCreateSchema = z.object({
  contacts: z.array(z.record(z.string(), z.unknown())).min(1, "Pass at least one contact.").max(100),
  ownerId: idSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* Read model                                                                 */
/* -------------------------------------------------------------------------- */

const suppressedSql = sql<boolean>`(${contact.email} is not null and exists (
  select 1 from ${suppression}
  where ${suppression.organizationId} = ${contact.organizationId}
    and ((${suppression.kind} = 'email' and ${suppression.value} = lower(${contact.email}))
      or (${suppression.kind} = 'domain' and ${suppression.value} = lower(split_part(${contact.email}, '@', 2))))
))`;

const selection = {
  ...getTableColumns(contact),
  companyName: company.name,
  companyDomain: company.domain,
  ownerName: user.name,
  ownerEmail: user.email,
  suppressed: suppressedSql,
};

export interface ContactDto {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  seniority: Seniority | null;
  department: string | null;
  email: string | null;
  emailStatus: ContactEmailStatus;
  emailVerifiedAt: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  stage: ContactStage;
  source: string;
  consentBasis: string | null;
  tags: string[];
  companyId: string | null;
  company: { id: string; name: string; domain: string | null } | null;
  ownerId: string | null;
  owner: { id: string; name: string; email: string } | null;
  suppressed: boolean;
  lastEnrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function contactName(c: { firstName: string | null; lastName: string | null; email: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed person";
}

function toDto(r: ContactRow): ContactDto {
  return {
    id: r.id,
    name: contactName(r),
    firstName: r.firstName,
    lastName: r.lastName,
    title: r.title,
    seniority: r.seniority,
    department: r.department,
    email: r.email,
    emailStatus: r.emailStatus,
    emailVerifiedAt: r.emailVerifiedAt?.toISOString() ?? null,
    phone: r.phone,
    linkedinUrl: r.linkedinUrl,
    city: r.city,
    state: r.state,
    country: r.country,
    timezone: r.timezone,
    stage: r.stage,
    source: r.source,
    consentBasis: r.consentBasis,
    tags: r.tags,
    companyId: r.companyId,
    company: r.companyId && r.companyName ? { id: r.companyId, name: r.companyName, domain: r.companyDomain } : null,
    ownerId: r.ownerId,
    owner: r.ownerId && r.ownerName ? { id: r.ownerId, name: r.ownerName, email: r.ownerEmail ?? "" } : null,
    suppressed: Boolean(r.suppressed),
    lastEnrichedAt: r.lastEnrichedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function baseQuery() {
  return db
    .select(selection)
    .from(contact)
    .leftJoin(company, eq(company.id, contact.companyId))
    .leftJoin(user, eq(user.id, contact.ownerId));
}

type ContactRow = Awaited<ReturnType<typeof baseQuery>>[number];

async function scopeChecks(actor: Actor, f: ContactSearch): Promise<void> {
  if (f.ownerId) await assertMember(actor, f.ownerId);
  if (f.companyId) await assertCompany(actor, f.companyId);
  if (f.listId) await assertList(actor, f.listId, "contact");
}

const lowerIn = (column: AnyPgColumn, values: string[]) =>
  inArray(
    sql`lower(${column})`,
    values.map((v) => v.toLowerCase()),
  );

function whereFor(actor: Actor, f: ContactSearch): SQL {
  const conditions: (SQL | undefined)[] = [eq(contact.organizationId, actor.organizationId)];
  if (f.q) {
    const pattern = likePattern(f.q);
    conditions.push(
      or(
        ilike(sql`coalesce(${contact.firstName}, '') || ' ' || coalesce(${contact.lastName}, '')`, pattern),
        ilike(contact.email, pattern),
        ilike(contact.title, pattern),
        ilike(company.name, pattern),
      ),
    );
  }
  if (f.title) {
    const words = f.title
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length) conditions.push(or(...words.map((w) => ilike(contact.title, likePattern(w)))));
  }
  if (f.seniority?.length) conditions.push(inArray(contact.seniority, f.seniority));
  if (f.department?.length) conditions.push(lowerIn(contact.department, f.department));
  if (f.emailStatus?.length) conditions.push(inArray(contact.emailStatus, f.emailStatus));
  if (f.stage?.length) conditions.push(inArray(contact.stage, f.stage));
  if (f.country?.length) conditions.push(lowerIn(contact.country, f.country));
  if (f.tags?.length) {
    conditions.push(
      sql`${contact.tags} && ARRAY[${sql.join(
        f.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`,
    );
  }
  if (f.companyId) conditions.push(eq(contact.companyId, f.companyId));
  if (f.ownerId) conditions.push(eq(contact.ownerId, f.ownerId));
  if (f.listId) conditions.push(inList(f.listId, contact.id));
  if (f.industry?.length) conditions.push(lowerIn(company.industry, f.industry));
  if (f.employeesMin !== undefined) conditions.push(sql`${company.employeeCount} >= ${f.employeesMin}`);
  if (f.employeesMax !== undefined) conditions.push(sql`${company.employeeCount} <= ${f.employeesMax}`);
  return and(...conditions) as SQL;
}

function orderFor(f: ContactSearch): SQL[] {
  const dir = f.sortAscending ? asc : desc;
  switch (f.sortBy) {
    case "name":
      return [dir(sql`lower(coalesce(${contact.lastName}, ''))`), dir(sql`lower(coalesce(${contact.firstName}, ''))`)];
    case "email":
      return [dir(contact.email)];
    case "title":
      return [dir(sql`lower(coalesce(${contact.title}, ''))`)];
    case "stage":
      return [dir(contact.stage)];
    case "updatedAt":
      return [dir(contact.updatedAt)];
    default:
      return [dir(contact.createdAt), asc(contact.id)];
  }
}

export async function searchContacts(actor: Actor, filters: ContactSearch, page: Page) {
  await scopeChecks(actor, filters);
  const where = whereFor(actor, filters);
  const [rows, [{ total }]] = await Promise.all([
    baseQuery()
      .where(where)
      .orderBy(...orderFor(filters), asc(contact.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ total: count() }).from(contact).leftJoin(company, eq(company.id, contact.companyId)).where(where),
  ]);
  return { contacts: rows.map(toDto), pagination: pagination(page, total) };
}

export async function getContact(actor: Actor, id: string): Promise<ContactDto> {
  const [row] = await baseQuery()
    .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.id, id)))
    .limit(1);
  if (!row) throw notFound("Contact not found.");
  return toDto(row);
}

export async function contactProvenance(actor: Actor, id: string) {
  await getContact(actor, id);
  return provenanceRows(actor, "contact", id);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

type ContactFields = Omit<ContactCreateInput, "runDedupe">;

async function checkForeignIds(actor: Actor, v: { ownerId?: string | null; companyId?: string | null }) {
  if (v.ownerId) await assertMember(actor, v.ownerId);
  if (v.companyId) await assertCompany(actor, v.companyId);
}

async function findByEmail(actor: Actor, email: string, exceptId?: string) {
  const [row] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, actor.organizationId),
        eq(contact.email, email),
        exceptId ? ne(contact.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

const PROVENANCE_SKIP = ["runDedupe"];

export async function createContact(
  actor: Actor,
  input: ContactCreateInput,
): Promise<{ contact: ContactDto; created: boolean }> {
  const { runDedupe, ...fields } = input;
  await checkForeignIds(actor, fields);
  if (fields.email) {
    const existing = await findByEmail(actor, fields.email);
    if (existing) {
      if (!runDedupe) {
        throw new HttpError(409, "A person with this email already exists.", { existingId: existing.id });
      }
      const { email: _email, ...rest } = fields;
      const updated = await updateContact(actor, existing.id, rest);
      return { contact: updated, created: false };
    }
  }
  const ownerId = fields.ownerId === undefined ? await defaultOwner(actor) : fields.ownerId;
  const [row] = await db
    .insert(contact)
    .values({ ...fields, ownerId, organizationId: actor.organizationId, source: writeSource(actor) })
    .returning({ id: contact.id });
  await recordProvenance(actor, "contact", provenanceFor(row.id, fields, PROVENANCE_SKIP), writeSource(actor));
  await audit(actor, "contact.create", "contact", row.id, { fields: Object.keys(fields) });
  return { contact: await getContact(actor, row.id), created: true };
}

export async function updateContact(actor: Actor, id: string, patch: ContactUpdateInput | ContactFields) {
  const [existing] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.id, id)))
    .limit(1);
  if (!existing) throw notFound("Contact not found.");
  await checkForeignIds(actor, patch);
  if (patch.email && (await findByEmail(actor, patch.email, id))) {
    throw conflict("Another person in this workspace already has this email.");
  }
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) {
    await db
      .update(contact)
      .set(set)
      .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.id, id)));
    await recordProvenance(actor, "contact", provenanceFor(id, set), writeSource(actor));
    await audit(actor, "contact.update", "contact", id, { fields: Object.keys(set) });
  }
  return getContact(actor, id);
}

async function assertAllInScope(actor: Actor, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.id, unique)));
  if (rows.length !== unique.length) {
    throw notFound(`${unique.length - rows.length} of these contacts weren't found.`);
  }
  return unique;
}

export async function deleteContact(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const [row] = await db
    .delete(contact)
    .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.id, id)))
    .returning({ id: contact.id });
  if (!row) throw notFound("Contact not found.");
  await cleanupEntities(actor, "contact", [id]);
  await audit(actor, "contact.delete", "contact", id);
  return { id, deleted: true };
}

export async function bulkDeleteContacts(actor: Actor, ids: string[]) {
  const scoped = await assertAllInScope(actor, ids);
  await db.delete(contact).where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.id, scoped)));
  await cleanupEntities(actor, "contact", scoped);
  await audit(actor, "contact.bulk_delete", "contact", null, { count: scoped.length });
  return { deleted: scoped.length, contactIds: scoped };
}

type BulkFields = Omit<z.infer<typeof contactBulkUpdateSchema>, "contactIds">;

export async function bulkUpdateContacts(
  actor: Actor,
  ids: string[],
  fields: BulkFields,
  action = "contact.bulk_update",
): Promise<{ contacts: ContactDto[] }> {
  const scoped = await assertAllInScope(actor, ids);
  await checkForeignIds(actor, fields);
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) throw unprocessable("Pass at least one field to update.");
  for (const part of chunk(scoped, 500)) {
    await db
      .update(contact)
      .set(set)
      .where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.id, part)));
  }
  await recordProvenance(
    actor,
    "contact",
    scoped.flatMap((id) => provenanceFor(id, set)),
    writeSource(actor),
  );
  await audit(actor, action, "contact", null, { count: scoped.length, fields: Object.keys(set) });
  const rows = await baseQuery()
    .where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.id, scoped.slice(0, 100))))
    .orderBy(asc(contact.id));
  return { contacts: rows.map(toDto) };
}

export async function bulkCreateContacts(actor: Actor, items: Record<string, unknown>[], ownerId?: string) {
  const parsed = items.map((item, index) => {
    const result = contactCreateSchema.safeParse(item);
    if (!result.success) {
      throw unprocessable(result.error.issues[0]?.message ?? "Invalid contact.", `contacts.${index}`);
    }
    return result.data;
  });
  if (ownerId) await assertMember(actor, ownerId);
  const owners = new Set(parsed.flatMap((p) => (p.ownerId ? [p.ownerId] : [])));
  const companies = new Set(parsed.flatMap((p) => (p.companyId ? [p.companyId] : [])));
  for (const o of owners) await assertMember(actor, o);
  for (const c of companies) await assertCompany(actor, c);

  const emails = parsed.flatMap((p) => (p.email ? [p.email] : []));
  const existingRows = emails.length
    ? await db
        .select({ id: contact.id, email: contact.email })
        .from(contact)
        .where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.email, emails)))
    : [];
  const byEmail = new Map(existingRows.map((r) => [r.email as string, r.id]));
  const fallbackOwner = ownerId ?? (await defaultOwner(actor));

  const createdIds: string[] = [];
  const existingIds: string[] = [];
  for (const { runDedupe: _r, ...fields } of parsed) {
    const known = fields.email ? byEmail.get(fields.email) : undefined;
    if (known) {
      existingIds.push(known);
      continue;
    }
    const [row] = await db
      .insert(contact)
      .values({
        ...fields,
        ownerId: fields.ownerId === undefined ? fallbackOwner : fields.ownerId,
        organizationId: actor.organizationId,
        source: writeSource(actor),
      })
      .returning({ id: contact.id });
    if (fields.email) byEmail.set(fields.email, row.id);
    createdIds.push(row.id);
    await recordProvenance(actor, "contact", provenanceFor(row.id, fields), writeSource(actor));
  }
  await audit(actor, "contact.bulk_create", "contact", null, {
    created: createdIds.length,
    existing: existingIds.length,
  });
  const load = async (ids: string[]) =>
    ids.length
      ? (await baseQuery().where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.id, ids)))).map(
          toDto,
        )
      : [];
  return { created_contacts: await load(createdIds), existing_contacts: await load([...new Set(existingIds)]) };
}

export function contactStages() {
  return {
    contact_stages: CONTACT_STAGES.map((id, index) => ({
      id,
      name: id,
      displayName: CONTACT_STAGE_LABELS[id],
      displayOrder: index + 1,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV import and export                                                      */
/* -------------------------------------------------------------------------- */

const IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "name",
  "email",
  "title",
  "seniority",
  "department",
  "phone",
  "linkedinUrl",
  "city",
  "state",
  "country",
  "timezone",
  "stage",
  "tags",
  "consentBasis",
  "companyName",
  "companyDomain",
] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

const IMPORT_ALIASES: Record<string, ImportField> = {
  firstname: "firstName",
  first: "firstName",
  givenname: "firstName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  familyname: "lastName",
  name: "name",
  fullname: "name",
  personname: "name",
  email: "email",
  emailaddress: "email",
  workemail: "email",
  businessemail: "email",
  title: "title",
  jobtitle: "title",
  position: "title",
  role: "title",
  seniority: "seniority",
  department: "department",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  directphone: "phone",
  linkedin: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  linkedinprofile: "linkedinUrl",
  personlinkedinurl: "linkedinUrl",
  city: "city",
  state: "state",
  region: "state",
  province: "state",
  country: "country",
  timezone: "timezone",
  stage: "stage",
  contactstage: "stage",
  tags: "tags",
  consentbasis: "consentBasis",
  company: "companyName",
  companyname: "companyName",
  organization: "companyName",
  organizationname: "companyName",
  account: "companyName",
  accountname: "companyName",
  companydomain: "companyDomain",
  domain: "companyDomain",
  website: "companyDomain",
  companywebsite: "companyDomain",
  websiteurl: "companyDomain",
};

function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

export async function importContacts(
  actor: Actor,
  payload: ImportPayload,
): Promise<ImportReport & { companiesCreated: number }> {
  const { columns, rows } = mapCsv(payload.csv, IMPORT_ALIASES, IMPORT_FIELDS, payload.mapping);
  const errors: ImportRowError[] = [];
  const report = { total: rows.length, created: 0, updated: 0, skipped: 0, companiesCreated: 0 };
  const source = "csv_import";
  const fail = (row: number, message: string) => {
    report.skipped++;
    if (errors.length < 200) errors.push({ row, message });
  };

  // Rows → validated field sets (row numbers are 1-based data rows; the header is row 1 of the file).
  type Prepared = { row: number; fields: ContactFields; companyName?: string; companyDomain?: string | null };
  const prepared: Prepared[] = [];
  const seen = new Map<string, number>();
  rows.forEach((raw, index) => {
    const row = index + 2;
    const r = raw as Partial<Record<ImportField, string>>;
    const named = r.name && !r.firstName && !r.lastName ? splitName(r.name) : null;
    const candidate = {
      firstName: r.firstName ?? named?.firstName,
      lastName: r.lastName ?? named?.lastName ?? undefined,
      email: r.email,
      title: r.title,
      seniority: csvEnum(r.seniority, SENIORITIES),
      department: r.department,
      phone: r.phone,
      linkedinUrl: r.linkedinUrl,
      city: r.city,
      state: r.state,
      country: r.country,
      timezone: r.timezone,
      stage: csvEnum(r.stage, CONTACT_STAGES),
      tags: csvList(r.tags),
      consentBasis: r.consentBasis,
    };
    const result = contactCreateSchema.safeParse(candidate);
    if (!result.success) {
      fail(row, result.error.issues[0]?.message ?? "Invalid row.");
      return;
    }
    const { runDedupe: _r, ...fields } = result.data;
    if (fields.email) {
      const first = seen.get(fields.email);
      if (first) {
        fail(row, `Duplicate of row ${first}.`);
        return;
      }
      seen.set(fields.email, row);
    }
    const companyDomain = r.companyDomain ? normalizeDomain(r.companyDomain) : null;
    prepared.push({ row, fields, companyName: r.companyName, companyDomain });
  });

  // Companies: link by domain, then by exact name; create the missing ones.
  const companyIds = await resolveImportCompanies(actor, prepared, source, (n) => {
    report.companiesCreated += n;
  });

  // Existing contacts by email.
  const emails = prepared.flatMap((p) => (p.fields.email ? [p.fields.email] : []));
  const existing = new Map<string, string>();
  for (const part of chunk(emails, 1000)) {
    const found = await db
      .select({ id: contact.id, email: contact.email })
      .from(contact)
      .where(and(eq(contact.organizationId, actor.organizationId), inArray(contact.email, part)));
    for (const f of found) existing.set(f.email as string, f.id);
  }

  const ownerId = await defaultOwner(actor);
  const provenance: { entityId: string; field: string; value: unknown }[] = [];
  const inserts: { row: number; values: typeof contact.$inferInsert; fields: Record<string, unknown> }[] = [];

  for (const p of prepared) {
    const setFields: Record<string, unknown> = Object.fromEntries(
      Object.entries(p.fields).filter(([, v]) => v !== undefined && v !== null),
    );
    const companyId = companyIds.get(p);
    if (companyId) setFields.companyId = companyId;
    const existingId = p.fields.email ? existing.get(p.fields.email) : undefined;
    if (existingId) {
      if (!payload.updateExisting) {
        fail(p.row, "Already in your workspace (skipped).");
        continue;
      }
      const { email: _e, ...update } = setFields;
      if (Object.keys(update).length) {
        await db
          .update(contact)
          .set(update)
          .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.id, existingId)));
        provenance.push(...provenanceFor(existingId, update));
      }
      report.updated++;
      continue;
    }
    inserts.push({
      row: p.row,
      fields: setFields,
      values: { ...setFields, ownerId, organizationId: actor.organizationId, source },
    });
  }

  for (const part of chunk(inserts, 500)) {
    try {
      const created = await db
        .insert(contact)
        .values(part.map((i) => i.values))
        .returning({ id: contact.id });
      created.forEach((c, i) => {
        provenance.push(...provenanceFor(c.id, part[i].fields));
      });
      report.created += created.length;
    } catch {
      // A concurrent write took one of the emails: fall back to row-by-row so the rest still import.
      for (const item of part) {
        try {
          const [c] = await db.insert(contact).values(item.values).returning({ id: contact.id });
          provenance.push(...provenanceFor(c.id, item.fields));
          report.created++;
        } catch {
          fail(item.row, "Couldn't save this row (the email may already exist).");
        }
      }
    }
  }

  await recordProvenance(actor, "contact", provenance, source, 0.9);
  await audit(actor, "contact.import", "contact", null, { ...report, errors: errors.length });
  return { ...report, errors, columns };
}

async function resolveImportCompanies<T extends { companyName?: string; companyDomain?: string | null }>(
  actor: Actor,
  rows: T[],
  source: string,
  onCreated: (n: number) => void,
): Promise<Map<T, string>> {
  const result = new Map<T, string>();
  const wanted = rows.filter((r) => r.companyDomain || r.companyName);
  if (!wanted.length) return result;
  const domains = [...new Set(wanted.flatMap((r) => (r.companyDomain ? [r.companyDomain] : [])))];
  const names = [...new Set(wanted.flatMap((r) => (r.companyName ? [r.companyName.toLowerCase()] : [])))];
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const part of chunk(domains, 1000)) {
    const found = await db
      .select({ id: company.id, domain: company.domain })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(company.domain, part)));
    for (const f of found) byDomain.set(f.domain as string, f.id);
  }
  for (const part of chunk(names, 1000)) {
    const found = await db
      .select({ id: company.id, name: company.name })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(sql`lower(${company.name})`, part)));
    for (const f of found) if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f.id);
  }
  let created = 0;
  for (const r of wanted) {
    let id = (r.companyDomain && byDomain.get(r.companyDomain)) || undefined;
    if (!id && !r.companyDomain && r.companyName) id = byName.get(r.companyName.toLowerCase());
    if (!id) {
      const name = r.companyName ?? r.companyDomain ?? "";
      const values = {
        organizationId: actor.organizationId,
        name: name.slice(0, 200),
        domain: r.companyDomain ?? null,
        websiteUrl: r.companyDomain ? `https://${r.companyDomain}` : null,
        source,
      };
      const [row] = await db.insert(company).values(values).onConflictDoNothing().returning({ id: company.id });
      if (row) {
        id = row.id;
        created++;
        await recordProvenance(
          actor,
          "company",
          provenanceFor(row.id, { name: values.name, domain: values.domain ?? undefined }),
          source,
          0.9,
        );
      } else if (r.companyDomain) {
        const [again] = await db
          .select({ id: company.id })
          .from(company)
          .where(and(eq(company.organizationId, actor.organizationId), eq(company.domain, r.companyDomain)))
          .limit(1);
        id = again?.id;
      }
      if (id && r.companyDomain) byDomain.set(r.companyDomain, id);
      if (id && r.companyName && !byName.has(r.companyName.toLowerCase())) byName.set(r.companyName.toLowerCase(), id);
    }
    if (id) result.set(r, id);
  }
  onCreated(created);
  return result;
}

const EXPORT_HEADER = [
  "id",
  "first_name",
  "last_name",
  "email",
  "email_status",
  "title",
  "seniority",
  "department",
  "phone",
  "linkedin_url",
  "city",
  "state",
  "country",
  "timezone",
  "stage",
  "tags",
  "company_name",
  "company_domain",
  "owner_email",
  "suppressed",
  "source",
  "created_at",
];

export async function exportContacts(actor: Actor, filters: ContactSearch): Promise<{ csv: string; count: number }> {
  await scopeChecks(actor, filters);
  const rows = await baseQuery()
    .where(whereFor(actor, filters))
    .orderBy(...orderFor(filters), asc(contact.id))
    .limit(EXPORT_MAX_ROWS);
  const csv = toCsv(
    EXPORT_HEADER,
    rows.map((r) => [
      r.id,
      r.firstName,
      r.lastName,
      r.email,
      r.emailStatus,
      r.title,
      r.seniority,
      r.department,
      r.phone,
      r.linkedinUrl,
      r.city,
      r.state,
      r.country,
      r.timezone,
      r.stage,
      r.tags,
      r.companyName,
      r.companyDomain,
      r.ownerEmail,
      Boolean(r.suppressed),
      r.source,
      r.createdAt,
    ]),
  );
  await audit(actor, "contact.export", "contact", null, { count: rows.length });
  return { csv, count: rows.length };
}
