import "server-only";

import { and, asc, count, desc, eq, getTableColumns, inArray, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { COMPANY_STAGE_LABELS, type CompanyStage } from "@/lib/records-vocabulary";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { conflict, HttpError, notFound } from "@/server/http/errors";
import { type Page, pagination } from "@/server/http/route";

import { audit } from "./audit";
import { type CustomFieldValue, mergeCustomFieldValues, validateCustomFieldValues } from "./custom-fields";
import {
  assertMember,
  chunk,
  cleanupEntities,
  csvEnum,
  csvInt,
  csvList,
  defaultOwner,
  domainSchema,
  EXPORT_MAX_ROWS,
  type ImportPayload,
  type ImportReport,
  type ImportRowError,
  idSchema,
  mapCsv,
  normalizeDomain,
  optionalText,
  provenanceFor,
  provenanceRows,
  recordProvenance,
  tagList,
  toCsv,
  unprocessable,
  writeSource,
} from "./records";
import {
  type CompanyFilters,
  companyConditions,
  companyFilterSchema,
  normalizeFilterInput,
  resolveFilterContext,
} from "./search-filters";

const { company, contact, user, suppression } = schema;

export const COMPANY_STAGES = company.stage.enumValues;

// The client-side vocabulary must list exactly the column enum.
const _vocabularyMatches: [(typeof COMPANY_STAGES)[number]] extends [CompanyStage]
  ? [CompanyStage] extends [(typeof COMPANY_STAGES)[number]]
    ? true
    : never
  : never = true;
void _vocabularyMatches;

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional();

const companyFieldShape = {
  name: optionalText(200),
  domain: domainSchema,
  websiteUrl: optionalText(500),
  linkedinUrl: optionalText(500),
  twitterUrl: optionalText(500),
  phone: optionalText(50),
  industry: optionalText(100),
  keywords: tagList.optional(),
  technologies: tagList.optional(),
  employeeCount: nullableInt(0, 10_000_000),
  annualRevenue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  foundedYear: nullableInt(1000, 2100),
  description: optionalText(5000),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  ownerId: idSchema.nullable().optional(),
  stage: z.enum(COMPANY_STAGES).optional(),
  /** Values for workspace custom fields (validated against the field types; null clears one). */
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const companyCreateSchema = z
  .object({ ...companyFieldShape, runDedupe: z.boolean().optional() })
  .refine((v) => Boolean(v.name || v.domain), { message: "Give the company a name or a domain.", path: ["name"] });
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const companyUpdateSchema = z
  .object(companyFieldShape)
  .refine((v) => v.name !== null, { message: "A company needs a name.", path: ["name"] })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

/** Company search filters (shared with saved searches and dynamic lists, see search-filters.ts). */
export const companySearchSchema = z.preprocess(
  (v) => (v && typeof v === "object" && !Array.isArray(v) ? normalizeFilterInput(v as Record<string, unknown>) : v),
  companyFilterSchema,
);
export type CompanySearch = CompanyFilters;

/** Apollo-style names accepted by `POST /mixed_companies/search` and `/accounts/search`. */
export function fromApolloCompanySearch(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const alias = (from: string, to: string) => {
    if (body[from] !== undefined && out[to] === undefined) out[to] = body[from];
    delete out[from];
  };
  alias("q_organization_name", "q");
  alias("q_keywords", "q");
  alias("organization_locations", "country");
  alias("q_organization_keyword_tags", "industry");
  alias("currently_using_any_of_technology_uids", "technologies");
  alias("q_organization_domains_list", "domains");
  alias("account_stage_ids", "stage");
  alias("account_label_ids", "listId");
  alias("sort_ascending", "sortAscending");
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
  return out;
}

const idsSchema = z.array(idSchema).min(1, "Pass at least one account id.").max(1000);

export const companyBulkUpdateSchema = z
  .object({
    accountIds: idsSchema,
    ownerId: idSchema.nullable().optional(),
    stage: z.enum(COMPANY_STAGES).optional(),
    industry: optionalText(100),
    city: optionalText(100),
    state: optionalText(100),
    country: optionalText(100),
    keywords: tagList.optional(),
    technologies: tagList.optional(),
  })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== "accountIds" && x !== undefined), {
    message: "Pass at least one field to update.",
  });

export const companyOwnersSchema = z.object({ accountIds: idsSchema, ownerId: idSchema.nullable() });
export const companyBulkDeleteSchema = z.object({ accountIds: idsSchema });
export const companyBulkCreateSchema = z.object({
  accounts: z.array(z.record(z.string(), z.unknown())).min(1, "Pass at least one account.").max(100),
});

/* -------------------------------------------------------------------------- */
/* Read model                                                                 */
/* -------------------------------------------------------------------------- */

const contactCountSql = sql<number>`(select count(*)::int from ${contact} where ${contact.companyId} = ${company.id})`;
const suppressedSql = sql<boolean>`(${company.domain} is not null and exists (
  select 1 from ${suppression}
  where ${suppression.organizationId} = ${company.organizationId}
    and ${suppression.kind} = 'domain' and ${suppression.value} = lower(${company.domain})
))`;

/** Last activity: the stored timestamp, or the latest timeline row for the company or its people. */
export const companyLastActivitySql = sql<Date | string | null>`coalesce(${company.lastActivityAt}, (
  select max(${schema.activity.occurredAt}) from ${schema.activity}
  where ${schema.activity.organizationId} = ${company.organizationId} and ${schema.activity.companyId} = ${company.id}
))`;

const selection = {
  ...getTableColumns(company),
  ownerName: user.name,
  ownerEmail: user.email,
  contactCount: contactCountSql,
  suppressed: suppressedSql,
  lastActivity: companyLastActivitySql,
};

function baseQuery() {
  return db.select(selection).from(company).leftJoin(user, eq(user.id, company.ownerId));
}

type CompanyRow = Awaited<ReturnType<typeof baseQuery>>[number];

export interface CompanyDto {
  id: string;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  phone: string | null;
  industry: string | null;
  keywords: string[];
  technologies: string[];
  employeeCount: number | null;
  annualRevenue: number | null;
  foundedYear: number | null;
  description: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  emailPattern: string | null;
  stage: CompanyStage;
  source: string;
  ownerId: string | null;
  owner: { id: string; name: string; email: string } | null;
  contactCount: number;
  suppressed: boolean;
  customFields: Record<string, unknown>;
  lastActivityAt: string | null;
  lastEnrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDto(r: CompanyRow): CompanyDto {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    websiteUrl: r.websiteUrl,
    linkedinUrl: r.linkedinUrl,
    twitterUrl: r.twitterUrl,
    phone: r.phone,
    industry: r.industry,
    keywords: r.keywords,
    technologies: r.technologies,
    employeeCount: r.employeeCount,
    annualRevenue: r.annualRevenue,
    foundedYear: r.foundedYear,
    description: r.description,
    city: r.city,
    state: r.state,
    country: r.country,
    emailPattern: r.emailPattern,
    stage: r.stage,
    source: r.source,
    ownerId: r.ownerId,
    owner: r.ownerId && r.ownerName ? { id: r.ownerId, name: r.ownerName, email: r.ownerEmail ?? "" } : null,
    contactCount: Number(r.contactCount ?? 0),
    suppressed: Boolean(r.suppressed),
    customFields: r.customFields ?? {},
    lastActivityAt: isoOrNull(r.lastActivity),
    lastEnrichedAt: r.lastEnrichedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function orderFor(f: CompanySearch): SQL[] {
  const dir = f.sortAscending ? asc : desc;
  const nulls = sql.raw(f.sortAscending ? "asc nulls last" : "desc nulls last");
  switch (f.sortBy) {
    case "name":
      return [dir(sql`lower(${company.name})`)];
    case "domain":
      return [dir(company.domain)];
    case "employeeCount":
      return [sql`${company.employeeCount} ${nulls}`];
    case "annualRevenue":
      return [sql`${company.annualRevenue} ${nulls}`];
    case "foundedYear":
      return [sql`${company.foundedYear} ${nulls}`];
    case "lastActivityAt":
      return [sql`${companyLastActivitySql} ${nulls}`];
    case "stage":
      return [dir(company.stage)];
    case "updatedAt":
      return [dir(company.updatedAt)];
    default:
      return [dir(company.createdAt)];
  }
}

export async function searchCompanies(actor: Actor, filters: CompanySearch, page: Page) {
  const ctx = await resolveFilterContext(actor, "company", filters);
  const where = companyConditions(filters, ctx);
  const [rows, [{ total }]] = await Promise.all([
    baseQuery()
      .where(where)
      .orderBy(...orderFor(filters), asc(company.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ total: count() }).from(company).where(where),
  ]);
  return { accounts: rows.map(toDto), pagination: pagination(page, total) };
}

/** Ids matching the filters (select-all). */
export async function companyIdsFor(
  actor: Actor,
  filters: CompanySearch,
  opts: { limit: number },
): Promise<{ ids: string[]; total: number }> {
  const ctx = await resolveFilterContext(actor, "company", filters);
  const where = companyConditions(filters, ctx);
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(company).where(where),
    db
      .select({ id: company.id })
      .from(company)
      .where(where)
      .orderBy(...orderFor(filters), asc(company.id))
      .limit(opts.limit),
  ]);
  return { ids: rows.map((r) => r.id), total };
}

export async function getCompany(actor: Actor, id: string): Promise<CompanyDto> {
  const [row] = await baseQuery()
    .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, id)))
    .limit(1);
  if (!row) throw notFound("Company not found.");
  return toDto(row);
}

export async function companyProvenance(actor: Actor, id: string) {
  await getCompany(actor, id);
  return provenanceRows(actor, "company", id);
}

/** Lightweight id/name list for pickers (people forms). */
export async function companyOptions(actor: Actor, limit = 500) {
  return db
    .select({ id: company.id, name: company.name, domain: company.domain })
    .from(company)
    .where(eq(company.organizationId, actor.organizationId))
    .orderBy(asc(sql`lower(${company.name})`))
    .limit(limit);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

async function findByDomain(actor: Actor, domain: string, exceptId?: string) {
  const [row] = await db
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.organizationId, actor.organizationId),
        eq(company.domain, domain),
        exceptId ? ne(company.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

function customProvenance(entityId: string, values: Record<string, CustomFieldValue>) {
  return Object.entries(values).map(([key, value]) => ({ entityId, field: `cf.${key}`, value }));
}

export async function createCompany(
  actor: Actor,
  input: CompanyCreateInput,
): Promise<{ account: CompanyDto; created: boolean }> {
  const { runDedupe, customFields: rawCustom, ...fields } = input;
  const custom = await validateCustomFieldValues(actor, "company", rawCustom);
  if (fields.ownerId) await assertMember(actor, fields.ownerId);
  if (fields.domain) {
    const existing = await findByDomain(actor, fields.domain);
    if (existing) {
      if (!runDedupe) {
        throw new HttpError(409, "A company with this domain already exists.", { existingId: existing.id });
      }
      const { domain: _d, ...rest } = fields;
      const hasChanges = Object.values(rest).some((v) => v !== undefined) || Object.keys(custom).length > 0;
      const account = hasChanges
        ? await updateCompany(actor, existing.id, { ...rest, customFields: rawCustom })
        : await getCompany(actor, existing.id);
      return { account, created: false };
    }
  }
  const name = fields.name ?? fields.domain ?? "";
  const ownerId = fields.ownerId === undefined ? await defaultOwner(actor) : fields.ownerId;
  const [row] = await db
    .insert(company)
    .values({
      ...fields,
      name,
      customFields: mergeCustomFieldValues({}, custom),
      websiteUrl: fields.websiteUrl ?? (fields.domain ? `https://${fields.domain}` : null),
      ownerId,
      organizationId: actor.organizationId,
      source: writeSource(actor),
    })
    .returning({ id: company.id });
  await recordProvenance(
    actor,
    "company",
    [...provenanceFor(row.id, { ...fields, name }), ...customProvenance(row.id, custom)],
    writeSource(actor),
  );
  await audit(actor, "company.create", "company", row.id, { fields: Object.keys(fields) });
  return { account: await getCompany(actor, row.id), created: true };
}

export async function updateCompany(actor: Actor, id: string, patch: Omit<CompanyUpdateInput, never>) {
  const [existing] = await db
    .select({ id: company.id, customFields: company.customFields })
    .from(company)
    .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, id)))
    .limit(1);
  if (!existing) throw notFound("Company not found.");
  const { customFields: rawCustom, ...plain } = patch;
  const custom = await validateCustomFieldValues(actor, "company", rawCustom);
  if (plain.ownerId) await assertMember(actor, plain.ownerId);
  if (plain.domain && (await findByDomain(actor, plain.domain, id))) {
    throw conflict("Another company in this workspace already has this domain.");
  }
  if (plain.name === null) throw unprocessable("A company needs a name.", "name");
  const set: Record<string, unknown> = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined));
  if (Object.keys(custom).length) set.customFields = mergeCustomFieldValues(existing.customFields, custom);
  if (Object.keys(set).length) {
    await db
      .update(company)
      .set(set)
      .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, id)));
    const { customFields: _cf, ...plainSet } = set;
    await recordProvenance(
      actor,
      "company",
      [...provenanceFor(id, plainSet), ...customProvenance(id, custom)],
      writeSource(actor),
    );
    await audit(actor, "company.update", "company", id, { fields: Object.keys(set) });
  }
  return getCompany(actor, id);
}

async function assertAllInScope(actor: Actor, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.organizationId, actor.organizationId), inArray(company.id, unique)));
  if (rows.length !== unique.length) {
    throw notFound(`${unique.length - rows.length} of these companies weren't found.`);
  }
  return unique;
}

export async function deleteCompany(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const [row] = await db
    .delete(company)
    .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, id)))
    .returning({ id: company.id });
  if (!row) throw notFound("Company not found.");
  await cleanupEntities(actor, "company", [id]);
  await audit(actor, "company.delete", "company", id);
  return { id, deleted: true };
}

export async function bulkDeleteCompanies(actor: Actor, ids: string[]) {
  const scoped = await assertAllInScope(actor, ids);
  await db.delete(company).where(and(eq(company.organizationId, actor.organizationId), inArray(company.id, scoped)));
  await cleanupEntities(actor, "company", scoped);
  await audit(actor, "company.bulk_delete", "company", null, { count: scoped.length });
  return { deleted: scoped.length, accountIds: scoped };
}

type BulkFields = Omit<z.infer<typeof companyBulkUpdateSchema>, "accountIds">;

export async function bulkUpdateCompanies(
  actor: Actor,
  ids: string[],
  fields: BulkFields,
  action = "company.bulk_update",
): Promise<{ accounts: CompanyDto[] }> {
  const scoped = await assertAllInScope(actor, ids);
  if (fields.ownerId) await assertMember(actor, fields.ownerId);
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) throw unprocessable("Pass at least one field to update.");
  for (const part of chunk(scoped, 500)) {
    await db
      .update(company)
      .set(set)
      .where(and(eq(company.organizationId, actor.organizationId), inArray(company.id, part)));
  }
  await recordProvenance(
    actor,
    "company",
    scoped.flatMap((id) => provenanceFor(id, set)),
    writeSource(actor),
  );
  await audit(actor, action, "company", null, { count: scoped.length, fields: Object.keys(set) });
  const rows = await baseQuery()
    .where(and(eq(company.organizationId, actor.organizationId), inArray(company.id, scoped.slice(0, 100))))
    .orderBy(asc(company.id));
  return { accounts: rows.map(toDto) };
}

export async function bulkCreateCompanies(actor: Actor, items: Record<string, unknown>[]) {
  const parsed = items.map((item, index) => {
    const result = companyCreateSchema.safeParse(item);
    if (!result.success) {
      throw unprocessable(result.error.issues[0]?.message ?? "Invalid account.", `accounts.${index}`);
    }
    return result.data;
  });
  const owners = new Set(parsed.flatMap((p) => (p.ownerId ? [p.ownerId] : [])));
  for (const o of owners) await assertMember(actor, o);

  const domains = parsed.flatMap((p) => (p.domain ? [p.domain] : []));
  const existingRows = domains.length
    ? await db
        .select({ id: company.id, domain: company.domain })
        .from(company)
        .where(and(eq(company.organizationId, actor.organizationId), inArray(company.domain, domains)))
    : [];
  const byDomain = new Map(existingRows.map((r) => [r.domain as string, r.id]));
  const fallbackOwner = await defaultOwner(actor);
  const createdIds: string[] = [];
  const existingIds: string[] = [];
  for (const { runDedupe: _r, customFields: rawCustom, ...fields } of parsed) {
    const custom = await validateCustomFieldValues(actor, "company", rawCustom);
    const known = fields.domain ? byDomain.get(fields.domain) : undefined;
    if (known) {
      existingIds.push(known);
      continue;
    }
    const name = fields.name ?? fields.domain ?? "";
    const [row] = await db
      .insert(company)
      .values({
        ...fields,
        name,
        customFields: mergeCustomFieldValues({}, custom),
        websiteUrl: fields.websiteUrl ?? (fields.domain ? `https://${fields.domain}` : null),
        ownerId: fields.ownerId === undefined ? fallbackOwner : fields.ownerId,
        organizationId: actor.organizationId,
        source: writeSource(actor),
      })
      .returning({ id: company.id });
    if (fields.domain) byDomain.set(fields.domain, row.id);
    createdIds.push(row.id);
    await recordProvenance(
      actor,
      "company",
      [...provenanceFor(row.id, { ...fields, name }), ...customProvenance(row.id, custom)],
      writeSource(actor),
    );
  }
  await audit(actor, "company.bulk_create", "company", null, {
    created: createdIds.length,
    existing: existingIds.length,
  });
  const load = async (ids: string[]) =>
    ids.length
      ? (await baseQuery().where(and(eq(company.organizationId, actor.organizationId), inArray(company.id, ids)))).map(
          toDto,
        )
      : [];
  return { created_accounts: await load(createdIds), existing_accounts: await load([...new Set(existingIds)]) };
}

export function accountStages() {
  return {
    account_stages: COMPANY_STAGES.map((id, index) => ({
      id,
      name: id,
      displayName: COMPANY_STAGE_LABELS[id],
      displayOrder: index + 1,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV import and export                                                      */
/* -------------------------------------------------------------------------- */

const IMPORT_FIELDS = [
  "name",
  "domain",
  "websiteUrl",
  "linkedinUrl",
  "twitterUrl",
  "phone",
  "industry",
  "keywords",
  "technologies",
  "employeeCount",
  "annualRevenue",
  "foundedYear",
  "description",
  "city",
  "state",
  "country",
  "stage",
] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

const IMPORT_ALIASES: Record<string, ImportField> = {
  name: "name",
  company: "name",
  companyname: "name",
  account: "name",
  accountname: "name",
  organization: "name",
  organizationname: "name",
  domain: "domain",
  companydomain: "domain",
  website: "websiteUrl",
  websiteurl: "websiteUrl",
  url: "websiteUrl",
  linkedin: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  companylinkedinurl: "linkedinUrl",
  twitter: "twitterUrl",
  twitterurl: "twitterUrl",
  phone: "phone",
  phonenumber: "phone",
  companyphone: "phone",
  industry: "industry",
  keywords: "keywords",
  technologies: "technologies",
  tech: "technologies",
  techstack: "technologies",
  employees: "employeeCount",
  employeecount: "employeeCount",
  numberofemployees: "employeeCount",
  headcount: "employeeCount",
  annualrevenue: "annualRevenue",
  revenue: "annualRevenue",
  foundedyear: "foundedYear",
  founded: "foundedYear",
  description: "description",
  shortdescription: "description",
  city: "city",
  state: "state",
  region: "state",
  country: "country",
  stage: "stage",
  accountstage: "stage",
};

export async function importCompanies(actor: Actor, payload: ImportPayload): Promise<ImportReport> {
  const { columns, rows } = mapCsv(payload.csv, IMPORT_ALIASES, IMPORT_FIELDS, payload.mapping);
  const errors: ImportRowError[] = [];
  const report = { total: rows.length, created: 0, updated: 0, skipped: 0 };
  const source = "csv_import";
  const fail = (row: number, message: string) => {
    report.skipped++;
    if (errors.length < 200) errors.push({ row, message });
  };

  type Fields = Omit<CompanyCreateInput, "runDedupe">;
  const prepared: { row: number; fields: Fields }[] = [];
  const seenDomains = new Map<string, number>();
  const seenNames = new Map<string, number>();
  rows.forEach((raw, index) => {
    const row = index + 2;
    const r = raw as Partial<Record<ImportField, string>>;
    const domainSource = r.domain ?? r.websiteUrl;
    const domain = domainSource ? normalizeDomain(domainSource) : undefined;
    if (r.domain && !domain) {
      fail(row, "The domain doesn't look valid.");
      return;
    }
    const candidate = {
      name: r.name,
      domain: domain ?? undefined,
      websiteUrl: r.websiteUrl,
      linkedinUrl: r.linkedinUrl,
      twitterUrl: r.twitterUrl,
      phone: r.phone,
      industry: r.industry,
      keywords: csvList(r.keywords),
      technologies: csvList(r.technologies),
      employeeCount: csvInt(r.employeeCount),
      annualRevenue: csvInt(r.annualRevenue),
      foundedYear: csvInt(r.foundedYear),
      description: r.description,
      city: r.city,
      state: r.state,
      country: r.country,
      stage: csvEnum(r.stage, COMPANY_STAGES),
    };
    const result = companyCreateSchema.safeParse(candidate);
    if (!result.success) {
      fail(row, result.error.issues[0]?.message ?? "Invalid row.");
      return;
    }
    const { runDedupe: _r, ...fields } = result.data;
    const key = fields.domain ?? undefined;
    const nameKey = !key && fields.name ? fields.name.toLowerCase() : undefined;
    const first = key ? seenDomains.get(key) : nameKey && seenNames.get(nameKey);
    if (first) {
      fail(row, `Duplicate of row ${first}.`);
      return;
    }
    if (key) seenDomains.set(key, row);
    if (nameKey) seenNames.set(nameKey, row);
    prepared.push({ row, fields });
  });

  // Existing companies: by domain, or by exact name when the row has no domain.
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  const domains = prepared.flatMap((p) => (p.fields.domain ? [p.fields.domain] : []));
  const names = prepared.flatMap((p) => (!p.fields.domain && p.fields.name ? [p.fields.name.toLowerCase()] : []));
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

  const ownerId = await defaultOwner(actor);
  const provenance: { entityId: string; field: string; value: unknown }[] = [];
  const inserts: { row: number; values: typeof company.$inferInsert; fields: Record<string, unknown> }[] = [];
  for (const p of prepared) {
    const setFields: Record<string, unknown> = Object.fromEntries(
      Object.entries(p.fields).filter(([, v]) => v !== undefined && v !== null),
    );
    let existingId: string | undefined;
    if (p.fields.domain) existingId = byDomain.get(p.fields.domain);
    else if (p.fields.name) existingId = byName.get(p.fields.name.toLowerCase());
    if (existingId) {
      if (!payload.updateExisting) {
        fail(p.row, "Already in your workspace (skipped).");
        continue;
      }
      const { domain: _d, ...update } = setFields;
      if (Object.keys(update).length) {
        await db
          .update(company)
          .set(update)
          .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, existingId)));
        provenance.push(...provenanceFor(existingId, update));
      }
      report.updated++;
      continue;
    }
    const name = (p.fields.name ?? p.fields.domain ?? "") as string;
    const fields = { ...setFields, name };
    inserts.push({
      row: p.row,
      fields,
      values: {
        ...fields,
        websiteUrl: p.fields.websiteUrl ?? (p.fields.domain ? `https://${p.fields.domain}` : null),
        ownerId,
        organizationId: actor.organizationId,
        source,
      },
    });
  }

  for (const part of chunk(inserts, 500)) {
    try {
      const created = await db
        .insert(company)
        .values(part.map((i) => i.values))
        .returning({ id: company.id });
      created.forEach((c, i) => {
        provenance.push(...provenanceFor(c.id, part[i].fields));
      });
      report.created += created.length;
    } catch {
      for (const item of part) {
        try {
          const [c] = await db.insert(company).values(item.values).returning({ id: company.id });
          provenance.push(...provenanceFor(c.id, item.fields));
          report.created++;
        } catch {
          fail(item.row, "Couldn't save this row (the domain may already exist).");
        }
      }
    }
  }

  await recordProvenance(actor, "company", provenance, source, 0.9);
  await audit(actor, "company.import", "company", null, { ...report, errors: errors.length });
  return { ...report, errors, columns };
}

const EXPORT_HEADER = [
  "id",
  "name",
  "domain",
  "website_url",
  "linkedin_url",
  "phone",
  "industry",
  "keywords",
  "technologies",
  "employee_count",
  "annual_revenue",
  "founded_year",
  "city",
  "state",
  "country",
  "stage",
  "owner_email",
  "people",
  "source",
  "created_at",
];

export async function exportCompanies(actor: Actor, filters: CompanySearch): Promise<{ csv: string; count: number }> {
  const ctx = await resolveFilterContext(actor, "company", filters);
  const rows = await baseQuery()
    .where(companyConditions(filters, ctx))
    .orderBy(...orderFor(filters), asc(company.id))
    .limit(EXPORT_MAX_ROWS);
  const csv = toCsv(
    EXPORT_HEADER,
    rows.map((r) => [
      r.id,
      r.name,
      r.domain,
      r.websiteUrl,
      r.linkedinUrl,
      r.phone,
      r.industry,
      r.keywords,
      r.technologies,
      r.employeeCount,
      r.annualRevenue,
      r.foundedYear,
      r.city,
      r.state,
      r.country,
      r.stage,
      r.ownerEmail,
      Number(r.contactCount ?? 0),
      r.source,
      r.createdAt,
    ]),
  );
  await audit(actor, "company.export", "company", null, { count: rows.length });
  return { csv, count: rows.length };
}
