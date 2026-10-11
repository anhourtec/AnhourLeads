import "server-only";

import { and, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import { EMPLOYEE_RANGE_KEYS, EMPLOYEE_RANGES, SEGMENTS, type SearchEntity } from "@/lib/search/filters";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";

import {
  assertMember,
  enumList,
  idSchema,
  likePattern,
  normalizeDomain,
  optionalBool,
  optionalInt,
  stringList,
} from "./records";

/**
 * Filters shared by people search, company search, saved searches and dynamic lists: input
 * schemas, SQL conditions, Total / Net new / Saved counts, facet counts and typeahead values.
 * Every query is scoped by the actor's workspace.
 */

const { contact, company, listMember, list, enrollment, deal, activity, outboundMessage, fieldProvenance, persona } =
  schema;

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

/** String or string[] without comma splitting (titles, companies and places can contain commas). */
const textList = (max = 50, itemMax = 200) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .transform((v) => [...new Set(v.map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(itemMax)).max(max))
    .optional();

const idList = (max = 50) => textList(max, 128);

const dateString = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Use a date like 2026-10-31." })
  .optional();

const yesNo = z.enum(["yes", "no"]).optional();

const sharedShape = {
  q: z.string().trim().max(200).optional(),
  location: textList(),
  locationExclude: textList(),
  country: stringList(),
  company: textList(),
  companyExclude: textList(),
  domains: stringList(1000, 255),
  employeeRanges: enumList(EMPLOYEE_RANGE_KEYS),
  employeesMin: optionalInt(0, 10_000_000),
  employeesMax: optionalInt(0, 10_000_000),
  employeesUnknown: optionalBool,
  industry: stringList(),
  industryExclude: textList(),
  keywords: textList(),
  keywordsExclude: textList(),
  technologies: stringList(),
  foundedMin: optionalInt(1000, 2100),
  foundedMax: optionalInt(1000, 2100),
  revenueMin: optionalInt(0, Number.MAX_SAFE_INTEGER),
  revenueMax: optionalInt(0, Number.MAX_SAFE_INTEGER),
  sequenceId: idList(),
  sequenceExclude: idList(),
  lastActivityFrom: dateString,
  lastActivityTo: dateString,
  createdFrom: dateString,
  createdTo: dateString,
  source: textList(20, 64),
  importId: idList(20),
  listId: idList(),
  listExclude: idList(),
  ownerId: idList(),
  cf: z.record(z.string().max(64), z.string().max(200)).optional(),
  segment: z.enum(SEGMENTS).optional(),
  sortAscending: optionalBool,
  /** Exact record ids (exports of a selection). */
  ids: idList(10_000),
};

export const peopleFilterSchema = z.object({
  ...sharedShape,
  name: z.string().trim().max(200).optional(),
  titles: textList(),
  titlesExclude: textList(),
  /** Legacy comma-separated "title contains any of". */
  title: z.string().trim().max(200).optional(),
  similarTitles: optionalBool,
  seniority: enumList(contact.seniority.enumValues),
  department: stringList(),
  personaId: idList(20),
  emailStatus: enumList(contact.emailStatus.enumValues),
  timezone: textList(20, 64),
  companyLocation: textList(),
  companyId: idSchema.optional(),
  stage: enumList(contact.stage.enumValues),
  tags: stringList(),
  emailSent: yesNo,
  emailOpened: yesNo,
  emailReplied: yesNo,
  emailBounced: yesNo,
  emailUnsubscribed: yesNo,
  sortBy: z
    .enum(["createdAt", "updatedAt", "lastActivityAt", "name", "email", "title", "stage", "company", "employeeCount"])
    .optional(),
});
export type PeopleFilters = z.infer<typeof peopleFilterSchema>;

export const companyFilterSchema = z.object({
  ...sharedShape,
  stage: enumList(company.stage.enumValues),
  sortBy: z
    .enum([
      "createdAt",
      "updatedAt",
      "lastActivityAt",
      "name",
      "domain",
      "employeeCount",
      "annualRevenue",
      "foundedYear",
      "stage",
    ])
    .optional(),
});
export type CompanyFilters = z.infer<typeof companyFilterSchema>;

/**
 * Raw input (URL params, JSON body, stored filters) → the shape the schemas take: `cf.<key>`
 * entries become `cf: { key }`, `key[]` loses its brackets, legacy dynamic-list names are mapped.
 */
export function normalizeFilterInput(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cf: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    const key = rawKey.replace(/\[\]$/, "");
    if (key.startsWith("cf.")) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v !== undefined && String(v).trim() !== "") cf[key.slice(3)] = String(v);
      continue;
    }
    if (key === "cf" && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined && v !== null && String(v).trim() !== "") cf[k] = String(v);
      }
      continue;
    }
    out[key] = value;
  }
  if (out.employeeMin !== undefined && out.employeesMin === undefined) out.employeesMin = out.employeeMin;
  if (out.employeeMax !== undefined && out.employeesMax === undefined) out.employeesMax = out.employeeMax;
  delete out.employeeMin;
  delete out.employeeMax;
  if (Object.keys(cf).length) out.cf = cf;
  return out;
}

export function parsePeopleFilters(raw: Record<string, unknown>): PeopleFilters {
  return peopleFilterSchema.parse(normalizeFilterInput(raw));
}

export function parseCompanyFilters(raw: Record<string, unknown>): CompanyFilters {
  return companyFilterSchema.parse(normalizeFilterInput(raw));
}

/** Lenient parse for URLs: drop keys that don't validate instead of failing the whole page. */
export function safeParseFilters<T extends PeopleFilters | CompanyFilters>(
  entity: SearchEntity,
  raw: Record<string, unknown>,
): T {
  const schemaFor = entity === "contact" ? peopleFilterSchema : companyFilterSchema;
  const input = normalizeFilterInput(raw);
  const parsed = schemaFor.safeParse(input);
  if (parsed.success) return parsed.data as T;
  const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  const retry = schemaFor.safeParse(Object.fromEntries(Object.entries(input).filter(([k]) => !bad.has(k))));
  return (retry.success ? retry.data : {}) as T;
}

/* -------------------------------------------------------------------------- */
/* Reference resolution (ids that must exist in the workspace)                 */
/* -------------------------------------------------------------------------- */

export interface FilterContext {
  organizationId: string;
  userId: string | null;
  /** Dynamic lists referenced by listId / listExclude, with their stored filters. */
  dynamicLists: Map<string, { entityType: SearchEntity; filters: Record<string, unknown> }>;
}

/** Check every referenced id belongs to the workspace (404 otherwise) and load dynamic lists. */
export async function resolveFilterContext(
  actor: Actor,
  entity: SearchEntity,
  f: PeopleFilters | CompanyFilters,
): Promise<FilterContext> {
  const ctx: FilterContext = { organizationId: actor.organizationId, userId: actor.userId, dynamicLists: new Map() };
  for (const id of f.ownerId ?? []) if (id !== "none" && id !== "me") await assertMember(actor, id);
  const listIds = [...new Set([...(f.listId ?? []), ...(f.listExclude ?? [])])];
  if (listIds.length) {
    const rows = await db
      .select({ id: list.id, kind: list.kind, entityType: list.entityType, filters: list.filters })
      .from(list)
      .where(
        and(eq(list.organizationId, actor.organizationId), inArray(list.id, listIds), eq(list.entityType, entity)),
      );
    if (rows.length !== listIds.length) throw notFound("List not found.");
    for (const r of rows) {
      if (r.kind === "dynamic") ctx.dynamicLists.set(r.id, { entityType: r.entityType, filters: r.filters ?? {} });
    }
  }
  const seqIds = [...(f.sequenceId ?? []), ...(f.sequenceExclude ?? [])].filter((id) => id !== "any");
  if (seqIds.length) {
    const rows = await db
      .select({ id: schema.sequence.id })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, actor.organizationId), inArray(schema.sequence.id, seqIds)));
    if (rows.length !== new Set(seqIds).size) throw notFound("Sequence not found.");
  }
  if ("personaId" in f && f.personaId?.length) {
    const rows = await db
      .select({ id: persona.id })
      .from(persona)
      .where(and(eq(persona.organizationId, actor.organizationId), inArray(persona.id, f.personaId)));
    if (rows.length !== f.personaId.length) throw notFound("Persona not found.");
  }
  if ("companyId" in f && f.companyId) {
    const [row] = await db
      .select({ id: company.id })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), eq(company.id, f.companyId)))
      .limit(1);
    if (!row) throw notFound("Company not found.");
  }
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* SQL helpers                                                                */
/* -------------------------------------------------------------------------- */

const lowerIn = (column: AnyPgColumn | SQL, values: string[]) =>
  inArray(
    sql`lower(${column})`,
    values.map((v) => v.toLowerCase()),
  );

const anyOf = (conds: (SQL | undefined)[]): SQL | undefined => {
  const list = conds.filter((c): c is SQL => Boolean(c));
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : or(...list);
};

const not = (cond: SQL | undefined): SQL | undefined => (cond ? sql`not coalesce((${cond}), false)` : undefined);

function placeMatch(city: AnyPgColumn, state: AnyPgColumn, country: AnyPgColumn, values: string[]): SQL | undefined {
  const lowered = values.map((v) => v.toLowerCase());
  return anyOf([
    inArray(sql`lower(${city})`, lowered),
    inArray(sql`lower(${state})`, lowered),
    inArray(sql`lower(${country})`, lowered),
  ]);
}

function companyNameMatch(values: string[]): SQL | undefined {
  return anyOf(values.map((v) => or(ilike(company.name, likePattern(v)), ilike(company.domain, likePattern(v)))));
}

function arrayContainsLike(column: AnyPgColumn, values: string[]): SQL {
  return sql`exists (select 1 from unnest(${column}) as k(v) where ${sql.join(
    values.map((v) => sql`k.v ilike ${likePattern(v)}`),
    sql` or `,
  )})`;
}

function employeeCondition(f: PeopleFilters | CompanyFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  for (const key of f.employeeRanges ?? []) {
    const r = EMPLOYEE_RANGES.find((x) => x.key === key);
    if (!r) continue;
    conds.push(
      r.max === null
        ? sql`${company.employeeCount} >= ${r.min}`
        : sql`${company.employeeCount} between ${r.min} and ${r.max}`,
    );
  }
  if (f.employeesMin !== undefined || f.employeesMax !== undefined) {
    conds.push(
      and(
        f.employeesMin !== undefined ? sql`${company.employeeCount} >= ${f.employeesMin}` : undefined,
        f.employeesMax !== undefined ? sql`${company.employeeCount} <= ${f.employeesMax}` : undefined,
      ),
    );
  }
  if (f.employeesUnknown) conds.push(isNull(company.employeeCount));
  return anyOf(conds);
}

/** "2026-10-31" → end of that day, so "to" dates include the whole day. */
function endOfDay(value: string): Date {
  const d = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) d.setUTCHours(23, 59, 59, 999);
  return d;
}

function dateRange(column: SQL | AnyPgColumn, from?: string, to?: string): SQL | undefined {
  return and(
    from ? sql`${column} >= ${new Date(from).toISOString()}` : undefined,
    to ? sql`${column} <= ${endOfDay(to).toISOString()}` : undefined,
  );
}

/** Company attribute conditions shared by both entities (the company table is joined for people). */
function companyAttributeConditions(f: PeopleFilters | CompanyFilters): (SQL | undefined)[] {
  const c: (SQL | undefined)[] = [];
  if (f.domains?.length) {
    const domains = f.domains.flatMap((d) => {
      const n = normalizeDomain(d);
      return n ? [n] : [];
    });
    c.push(domains.length ? inArray(company.domain, domains) : sql`false`);
  }
  c.push(employeeCondition(f));
  if (f.industry?.length) c.push(lowerIn(company.industry, f.industry));
  if (f.industryExclude?.length) c.push(not(lowerIn(company.industry, f.industryExclude)));
  if (f.keywords?.length) c.push(arrayContainsLike(company.keywords, f.keywords));
  if (f.keywordsExclude?.length) c.push(not(arrayContainsLike(company.keywords, f.keywordsExclude)));
  if (f.technologies?.length) {
    const wanted = f.technologies.map((t) => t.toLowerCase());
    c.push(
      sql`exists (select 1 from unnest(${company.technologies}) as t(name) where lower(t.name) in (${sql.join(
        wanted.map((w) => sql`${w}`),
        sql`, `,
      )}))`,
    );
  }
  if (f.foundedMin !== undefined) c.push(sql`${company.foundedYear} >= ${f.foundedMin}`);
  if (f.foundedMax !== undefined) c.push(sql`${company.foundedYear} <= ${f.foundedMax}`);
  if (f.revenueMin !== undefined) c.push(sql`${company.annualRevenue} >= ${f.revenueMin}`);
  if (f.revenueMax !== undefined) c.push(sql`${company.annualRevenue} <= ${f.revenueMax}`);
  return c;
}

function customFieldConditions(column: AnyPgColumn, cf: Record<string, string> | undefined): (SQL | undefined)[] {
  return Object.entries(cf ?? {}).map(([key, value]) => {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "false") return sql`(${column} ->> ${key}) = ${lower}`;
    return sql`(${column} ->> ${key}) ilike ${likePattern(value)}`;
  });
}

function ownerCondition(column: AnyPgColumn, ids: string[] | undefined, ctx: FilterContext): SQL | undefined {
  if (!ids?.length) return undefined;
  const real = ids.flatMap((id) => {
    if (id === "none") return [];
    if (id === "me") return ctx.userId ? [ctx.userId] : [];
    return [id];
  });
  return (
    anyOf([real.length ? inArray(column, real) : undefined, ids.includes("none") ? isNull(column) : undefined]) ??
    sql`false`
  );
}

function importCondition(entityType: SearchEntity, idColumn: AnyPgColumn, ids: string[] | undefined, org: string) {
  if (!ids?.length) return undefined;
  return sql`exists (select 1 from ${fieldProvenance} where ${fieldProvenance.organizationId} = ${org}
    and ${fieldProvenance.entityType} = ${entityType} and ${fieldProvenance.entityId} = ${idColumn}
    and ${fieldProvenance.sourceUrl} in (${sql.join(
      ids.map((id) => sql`${`import:${id}`}`),
      sql`, `,
    )}))`;
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

export const contactLastActivitySql = sql`coalesce(${contact.lastActivityAt}, (
  select max(${activity.occurredAt}) from ${activity}
  where ${activity.organizationId} = ${contact.organizationId} and ${activity.contactId} = ${contact.id}
))`;

const contactInAnyList = sql`exists (select 1 from ${listMember} inner join ${list} on ${list.id} = ${listMember.listId}
  where ${listMember.entityId} = ${contact.id} and ${list.organizationId} = ${contact.organizationId})`;
const contactInAnySequence = sql`exists (select 1 from ${enrollment}
  where ${enrollment.contactId} = ${contact.id} and ${enrollment.organizationId} = ${contact.organizationId})`;
const contactInAnyDeal = sql`exists (select 1 from ${deal}
  where ${deal.contactId} = ${contact.id} and ${deal.organizationId} = ${contact.organizationId})`;

/** Net new: not yet in any list, sequence or deal. */
export const contactNetNewSql = sql`not (${contactInAnyList} or ${contactInAnySequence} or ${contactInAnyDeal})`;

const TITLE_STOPWORDS = new Set(["of", "the", "and", "for", "a", "an", "&", "-", "at", "in"]);

function titleCondition(t: string, similar: boolean): SQL | undefined {
  const quoted = t.match(/^"(.+)"$/);
  if (quoted) return sql`lower(${contact.title}) = ${quoted[1].trim().toLowerCase()}`;
  if (!similar) return ilike(contact.title, likePattern(t));
  const words = t.split(/\s+/).filter((w) => w && !TITLE_STOPWORDS.has(w.toLowerCase()));
  if (!words.length) return ilike(contact.title, likePattern(t));
  return and(...words.map((w) => ilike(contact.title, likePattern(w))));
}

function contactSequenceCondition(ids: string[]): SQL {
  if (ids.includes("any")) return contactInAnySequence;
  return sql`exists (select 1 from ${enrollment} where ${enrollment.contactId} = ${contact.id}
    and ${enrollment.organizationId} = ${contact.organizationId} and ${enrollment.sequenceId} in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}))`;
}

function contactActivityExists(types: string[]): SQL {
  return sql`exists (select 1 from ${activity} where ${activity.organizationId} = ${contact.organizationId}
    and ${activity.contactId} = ${contact.id} and ${activity.type} in (${sql.join(
      types.map((t) => sql`${t}`),
      sql`, `,
    )}))`;
}

function contactEnrollmentStatus(statuses: string[]): SQL {
  return sql`exists (select 1 from ${enrollment} where ${enrollment.organizationId} = ${contact.organizationId}
    and ${enrollment.contactId} = ${contact.id} and ${enrollment.status} in (${sql.join(
      statuses.map((s) => sql`${s}`),
      sql`, `,
    )}))`;
}

function contactMessageStatus(statuses: string[]): SQL {
  return sql`exists (select 1 from ${outboundMessage} where ${outboundMessage.organizationId} = ${contact.organizationId}
    and ${outboundMessage.contactId} = ${contact.id} and ${outboundMessage.status} in (${sql.join(
      statuses.map((s) => sql`${s}`),
      sql`, `,
    )}))`;
}

const ENGAGEMENT_SQL: Record<
  "emailSent" | "emailOpened" | "emailReplied" | "emailBounced" | "emailUnsubscribed",
  () => SQL
> = {
  emailSent: () => or(contactMessageStatus(["sent", "bounced"]), contactActivityExists(["email_sent"])) as SQL,
  emailOpened: () => contactActivityExists(["email_opened"]),
  emailReplied: () => or(contactEnrollmentStatus(["replied"]), contactActivityExists(["email_replied"])) as SQL,
  emailBounced: () =>
    or(
      contactMessageStatus(["bounced"]),
      contactEnrollmentStatus(["bounced"]),
      contactActivityExists(["email_bounced"]),
    ) as SQL,
  emailUnsubscribed: () =>
    or(contactEnrollmentStatus(["unsubscribed"]), contactActivityExists(["email_unsubscribed"])) as SQL,
};

function personaCondition(ids: string[]): SQL {
  const p = persona;
  return sql`exists (select 1 from ${p} where ${p.organizationId} = ${contact.organizationId} and ${p.id} in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}) and (
    ${contact.personaId} = ${p.id} or (
      (cardinality(${p.titles}) > 0 or cardinality(${p.seniorities}) > 0 or cardinality(${p.departments}) > 0)
      and (cardinality(${p.titles}) = 0 or exists (select 1 from unnest(${p.titles}) as pt(v)
        where ${contact.title} ilike '%' || replace(replace(pt.v, '%', '\\%'), '_', '\\_') || '%'))
      and (cardinality(${p.seniorities}) = 0 or ${contact.seniority}::text = any(${p.seniorities}))
      and (cardinality(${p.departments}) = 0 or lower(${contact.department}) in (select lower(pd.v) from unnest(${p.departments}) as pd(v)))
    )
  ))`;
}

/**
 * Conditions for a people search. `omit` drops one filter (and its siblings) so facet counts can
 * show what each option would match. The company table must be left-joined on contact.company_id.
 */
export function peopleConditions(f: PeopleFilters, ctx: FilterContext, omit: string[] = [], depth = 0): SQL {
  const skip = new Set(omit);
  const has = (key: string) => !skip.has(key);
  const c: (SQL | undefined)[] = [eq(contact.organizationId, ctx.organizationId)];
  if (f.ids?.length) c.push(inArray(contact.id, f.ids));
  if (f.q) {
    const pattern = likePattern(f.q);
    c.push(
      or(
        ilike(sql`coalesce(${contact.firstName}, '') || ' ' || coalesce(${contact.lastName}, '')`, pattern),
        ilike(contact.email, pattern),
        ilike(contact.title, pattern),
        ilike(company.name, pattern),
      ),
    );
  }
  if (f.name) {
    c.push(
      ilike(sql`coalesce(${contact.firstName}, '') || ' ' || coalesce(${contact.lastName}, '')`, likePattern(f.name)),
    );
  }
  if (has("titles")) {
    const similar = f.similarTitles !== false;
    if (f.titles?.length) c.push(anyOf(f.titles.map((t) => titleCondition(t, similar))));
    if (f.title) {
      const words = f.title
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
      if (words.length) c.push(anyOf(words.map((w) => ilike(contact.title, likePattern(w)))));
    }
  }
  if (f.titlesExclude?.length)
    c.push(not(anyOf(f.titlesExclude.map((t) => ilike(contact.title, likePattern(t.replace(/^"|"$/g, "")))))));
  if (has("seniority") && f.seniority?.length) c.push(inArray(contact.seniority, f.seniority));
  if (has("department") && f.department?.length) {
    c.push(
      anyOf(
        f.department.map((d) =>
          or(sql`lower(${contact.department}) = ${d.toLowerCase()}`, ilike(contact.department, likePattern(d))),
        ),
      ),
    );
  }
  if (f.personaId?.length) c.push(personaCondition(f.personaId));
  if (has("emailStatus") && f.emailStatus?.length) c.push(inArray(contact.emailStatus, f.emailStatus));
  if (has("location") && f.location?.length)
    c.push(placeMatch(contact.city, contact.state, contact.country, f.location));
  if (f.locationExclude?.length)
    c.push(not(placeMatch(contact.city, contact.state, contact.country, f.locationExclude)));
  if (has("location") && f.country?.length) c.push(lowerIn(contact.country, f.country));
  if (f.timezone?.length) c.push(lowerIn(contact.timezone, f.timezone));
  if (f.company?.length) c.push(companyNameMatch(f.company));
  if (f.companyExclude?.length) c.push(not(companyNameMatch(f.companyExclude)));
  if (f.companyLocation?.length) c.push(placeMatch(company.city, company.state, company.country, f.companyLocation));
  if (f.companyId) c.push(eq(contact.companyId, f.companyId));
  const companyFilters: PeopleFilters = { ...f };
  if (!has("employees")) {
    companyFilters.employeeRanges = undefined;
    companyFilters.employeesMin = undefined;
    companyFilters.employeesMax = undefined;
    companyFilters.employeesUnknown = undefined;
  }
  if (!has("industry")) companyFilters.industry = undefined;
  c.push(...companyAttributeConditions(companyFilters));
  if (f.sequenceId?.length) c.push(contactSequenceCondition(f.sequenceId));
  if (f.sequenceExclude?.length) c.push(not(contactSequenceCondition(f.sequenceExclude)));
  c.push(dateRange(contactLastActivitySql, f.lastActivityFrom, f.lastActivityTo));
  c.push(dateRange(contact.createdAt, f.createdFrom, f.createdTo));
  for (const flag of ["emailSent", "emailOpened", "emailReplied", "emailBounced", "emailUnsubscribed"] as const) {
    const v = f[flag];
    if (v === "yes") c.push(ENGAGEMENT_SQL[flag]());
    if (v === "no") c.push(not(ENGAGEMENT_SQL[flag]()));
  }
  if (has("source") && f.source?.length) c.push(inArray(contact.source, f.source));
  c.push(importCondition("contact", contact.id, f.importId, ctx.organizationId));
  for (const listIds of [f.listId, f.listExclude]) {
    if (!listIds?.length) continue;
    const conds = listIds.map((id) => {
      const dyn = ctx.dynamicLists.get(id);
      if (dyn) {
        if (depth > 0) return sql`false`;
        const inner = safeParseFilters<PeopleFilters>("contact", dyn.filters);
        return peopleConditions(
          { ...inner, listId: undefined, listExclude: undefined, segment: undefined },
          ctx,
          [],
          depth + 1,
        );
      }
      return sql`exists (select 1 from ${listMember} where ${listMember.listId} = ${id} and ${listMember.entityId} = ${contact.id})`;
    });
    c.push(listIds === f.listId ? anyOf(conds) : not(anyOf(conds)));
  }
  if (has("owner")) c.push(ownerCondition(contact.ownerId, f.ownerId, ctx));
  if (has("stage") && f.stage?.length) c.push(inArray(contact.stage, f.stage));
  if (f.tags?.length) {
    c.push(
      sql`${contact.tags} && ARRAY[${sql.join(
        f.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`,
    );
  }
  c.push(...customFieldConditions(contact.customFields, f.cf));
  if (has("segment")) {
    if (f.segment === "net_new") c.push(contactNetNewSql);
    if (f.segment === "saved") c.push(ctx.userId ? eq(contact.ownerId, ctx.userId) : sql`false`);
  }
  return and(...c) as SQL;
}

/* -------------------------------------------------------------------------- */
/* Companies                                                                  */
/* -------------------------------------------------------------------------- */

export const companyLastActivitySql = sql`coalesce(${company.lastActivityAt}, (
  select max(${activity.occurredAt}) from ${activity}
  where ${activity.organizationId} = ${company.organizationId} and ${activity.companyId} = ${company.id}
))`;

const companyInAnyList = sql`exists (select 1 from ${listMember} inner join ${list} on ${list.id} = ${listMember.listId}
  where ${listMember.entityId} = ${company.id} and ${list.organizationId} = ${company.organizationId})`;
const companyInAnySequence = sql`exists (select 1 from ${enrollment} inner join ${contact} on ${contact.id} = ${enrollment.contactId}
  where ${contact.companyId} = ${company.id} and ${enrollment.organizationId} = ${company.organizationId})`;
const companyInAnyDeal = sql`exists (select 1 from ${deal}
  where ${deal.companyId} = ${company.id} and ${deal.organizationId} = ${company.organizationId})`;

export const companyNetNewSql = sql`not (${companyInAnyList} or ${companyInAnySequence} or ${companyInAnyDeal})`;

function companySequenceCondition(ids: string[]): SQL {
  if (ids.includes("any")) return companyInAnySequence;
  return sql`exists (select 1 from ${enrollment} inner join ${contact} on ${contact.id} = ${enrollment.contactId}
    where ${contact.companyId} = ${company.id} and ${enrollment.organizationId} = ${company.organizationId}
    and ${enrollment.sequenceId} in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}))`;
}

export function companyConditions(f: CompanyFilters, ctx: FilterContext, omit: string[] = [], depth = 0): SQL {
  const skip = new Set(omit);
  const has = (key: string) => !skip.has(key);
  const c: (SQL | undefined)[] = [eq(company.organizationId, ctx.organizationId)];
  if (f.ids?.length) c.push(inArray(company.id, f.ids));
  if (f.q) {
    const pattern = likePattern(f.q);
    c.push(or(ilike(company.name, pattern), ilike(company.domain, pattern)));
  }
  if (f.company?.length) c.push(companyNameMatch(f.company));
  if (f.companyExclude?.length) c.push(not(companyNameMatch(f.companyExclude)));
  if (has("location") && f.location?.length)
    c.push(placeMatch(company.city, company.state, company.country, f.location));
  if (f.locationExclude?.length)
    c.push(not(placeMatch(company.city, company.state, company.country, f.locationExclude)));
  if (has("location") && f.country?.length) c.push(lowerIn(company.country, f.country));
  const attr: CompanyFilters = { ...f };
  if (!has("employees")) {
    attr.employeeRanges = undefined;
    attr.employeesMin = undefined;
    attr.employeesMax = undefined;
    attr.employeesUnknown = undefined;
  }
  if (!has("industry")) attr.industry = undefined;
  c.push(...companyAttributeConditions(attr));
  if (f.sequenceId?.length) c.push(companySequenceCondition(f.sequenceId));
  if (f.sequenceExclude?.length) c.push(not(companySequenceCondition(f.sequenceExclude)));
  c.push(dateRange(companyLastActivitySql, f.lastActivityFrom, f.lastActivityTo));
  c.push(dateRange(company.createdAt, f.createdFrom, f.createdTo));
  if (has("source") && f.source?.length) c.push(inArray(company.source, f.source));
  c.push(importCondition("company", company.id, f.importId, ctx.organizationId));
  for (const listIds of [f.listId, f.listExclude]) {
    if (!listIds?.length) continue;
    const conds = listIds.map((id) => {
      const dyn = ctx.dynamicLists.get(id);
      if (dyn) {
        if (depth > 0) return sql`false`;
        const inner = safeParseFilters<CompanyFilters>("company", dyn.filters);
        return companyConditions(
          { ...inner, listId: undefined, listExclude: undefined, segment: undefined },
          ctx,
          [],
          depth + 1,
        );
      }
      return sql`exists (select 1 from ${listMember} where ${listMember.listId} = ${id} and ${listMember.entityId} = ${company.id})`;
    });
    c.push(listIds === f.listId ? anyOf(conds) : not(anyOf(conds)));
  }
  if (has("owner")) c.push(ownerCondition(company.ownerId, f.ownerId, ctx));
  if (has("stage") && f.stage?.length) c.push(inArray(company.stage, f.stage));
  c.push(...customFieldConditions(company.customFields, f.cf));
  if (has("segment")) {
    if (f.segment === "net_new") c.push(companyNetNewSql);
    if (f.segment === "saved") c.push(ctx.userId ? eq(company.ownerId, ctx.userId) : sql`false`);
  }
  return and(...c) as SQL;
}

/* -------------------------------------------------------------------------- */
/* Counts and facets                                                          */
/* -------------------------------------------------------------------------- */

export interface SegmentCounts {
  total: number;
  net_new: number;
  saved: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export type Facets = Record<string, FacetValue[]>;

/** Total / Net new / Saved under the current filters (the segment itself ignored). */
export async function segmentCounts(
  entity: SearchEntity,
  f: PeopleFilters | CompanyFilters,
  ctx: FilterContext,
): Promise<SegmentCounts> {
  const savedCond = ctx.userId
    ? sql`${entity === "contact" ? contact.ownerId : company.ownerId} = ${ctx.userId}`
    : sql`false`;
  if (entity === "contact") {
    const where = peopleConditions(f as PeopleFilters, ctx, ["segment"]);
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        netNew: sql<number>`(count(*) filter (where ${contactNetNewSql}))::int`,
        saved: sql<number>`(count(*) filter (where ${savedCond}))::int`,
      })
      .from(contact)
      .leftJoin(company, eq(company.id, contact.companyId))
      .where(where);
    return { total: row?.total ?? 0, net_new: row?.netNew ?? 0, saved: row?.saved ?? 0 };
  }
  const where = companyConditions(f as CompanyFilters, ctx, ["segment"]);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      netNew: sql<number>`(count(*) filter (where ${companyNetNewSql}))::int`,
      saved: sql<number>`(count(*) filter (where ${savedCond}))::int`,
    })
    .from(company)
    .where(where);
  return { total: row?.total ?? 0, net_new: row?.netNew ?? 0, saved: row?.saved ?? 0 };
}

const employeeBucketSql = sql<string | null>`case
  ${sql.join(
    EMPLOYEE_RANGES.map((r) =>
      r.max === null
        ? sql`when ${company.employeeCount} >= ${r.min} then ${r.key}`
        : sql`when ${company.employeeCount} between ${r.min} and ${r.max} then ${r.key}`,
    ),
    sql` `,
  )}
  else null end`;

interface FacetDef {
  name: string;
  omit: string[];
  expr: SQL;
  limit: number;
}

const PEOPLE_FACETS: FacetDef[] = [
  { name: "seniority", omit: ["seniority"], expr: sql`${contact.seniority}::text`, limit: 20 },
  { name: "emailStatus", omit: ["emailStatus"], expr: sql`${contact.emailStatus}::text`, limit: 20 },
  { name: "stage", omit: ["stage"], expr: sql`${contact.stage}::text`, limit: 20 },
  { name: "department", omit: ["department"], expr: sql`${contact.department}`, limit: 30 },
  { name: "country", omit: ["location"], expr: sql`${contact.country}`, limit: 30 },
  { name: "employeeRanges", omit: ["employees"], expr: employeeBucketSql, limit: 20 },
  { name: "industry", omit: ["industry"], expr: sql`${company.industry}`, limit: 30 },
  { name: "source", omit: ["source"], expr: sql`${contact.source}`, limit: 20 },
  { name: "ownerId", omit: ["owner"], expr: sql`coalesce(${contact.ownerId}, 'none')`, limit: 50 },
];

const COMPANY_FACETS: FacetDef[] = [
  { name: "stage", omit: ["stage"], expr: sql`${company.stage}::text`, limit: 20 },
  { name: "country", omit: ["location"], expr: sql`${company.country}`, limit: 30 },
  { name: "employeeRanges", omit: ["employees"], expr: employeeBucketSql, limit: 20 },
  { name: "industry", omit: ["industry"], expr: sql`${company.industry}`, limit: 30 },
  { name: "source", omit: ["source"], expr: sql`${company.source}`, limit: 20 },
  { name: "ownerId", omit: ["owner"], expr: sql`coalesce(${company.ownerId}, 'none')`, limit: 50 },
];

/**
 * Grouped counts per filter option under the current filter set, each facet ignoring its own
 * filter (so the counts say what ticking another option would add).
 */
export async function facetCounts(
  entity: SearchEntity,
  f: PeopleFilters | CompanyFilters,
  ctx: FilterContext,
): Promise<Facets> {
  const defs = entity === "contact" ? PEOPLE_FACETS : COMPANY_FACETS;
  const results = await Promise.all(
    defs.map(async (d) => {
      const value = sql<string | null>`${d.expr}`;
      const rows =
        entity === "contact"
          ? await db
              .select({ value, count: sql<number>`count(*)::int` })
              .from(contact)
              .leftJoin(company, eq(company.id, contact.companyId))
              .where(and(peopleConditions(f as PeopleFilters, ctx, d.omit), sql`${d.expr} is not null`))
              .groupBy(sql`1`)
              .orderBy(desc(sql`2`))
              .limit(d.limit)
          : await db
              .select({ value, count: sql<number>`count(*)::int` })
              .from(company)
              .where(and(companyConditions(f as CompanyFilters, ctx, d.omit), sql`${d.expr} is not null`))
              .groupBy(sql`1`)
              .orderBy(desc(sql`2`))
              .limit(d.limit);
      return [
        d.name,
        rows.filter((r) => r.value !== null).map((r) => ({ value: String(r.value), count: r.count })),
      ] as const;
    }),
  );
  return Object.fromEntries(results);
}

/* -------------------------------------------------------------------------- */
/* Typeahead values and quick filters                                         */
/* -------------------------------------------------------------------------- */

export const FILTER_VALUE_FIELDS = [
  "titles",
  "location",
  "companyLocation",
  "industry",
  "keywords",
  "technologies",
  "company",
  "department",
  "timezone",
  "source",
] as const;
export type FilterValueField = (typeof FILTER_VALUE_FIELDS)[number];

export const filterValuesQuery = z.object({
  field: z.enum(FILTER_VALUE_FIELDS),
  q: z.string().trim().max(100).optional(),
  limit: optionalInt(1, 50),
});

/** Distinct values in the workspace for a typeahead, most common first. */
export async function filterValues(
  actor: Actor,
  entity: SearchEntity,
  field: FilterValueField,
  q = "",
  limit = 20,
): Promise<FacetValue[]> {
  const org = actor.organizationId;
  const pattern = likePattern(q);
  const ofContacts = (expr: SQL) =>
    sql`select ${expr} as v from ${contact} left join ${company} on ${company.id} = ${contact.companyId} where ${contact.organizationId} = ${org}`;
  const ofCompanies = (expr: SQL) => sql`select ${expr} as v from ${company} where ${company.organizationId} = ${org}`;
  const base = entity === "contact" ? ofContacts : ofCompanies;
  let source: SQL;
  switch (field) {
    case "titles":
      source = ofContacts(sql`${contact.title}`);
      break;
    case "department":
      source = ofContacts(sql`${contact.department}`);
      break;
    case "timezone":
      source = ofContacts(sql`${contact.timezone}`);
      break;
    case "location":
      source =
        entity === "contact"
          ? sql`${ofContacts(sql`${contact.country}`)} union all ${ofContacts(sql`${contact.state}`)} union all ${ofContacts(sql`${contact.city}`)}`
          : sql`${ofCompanies(sql`${company.country}`)} union all ${ofCompanies(sql`${company.state}`)} union all ${ofCompanies(sql`${company.city}`)}`;
      break;
    case "companyLocation":
      source = sql`${ofCompanies(sql`${company.country}`)} union all ${ofCompanies(sql`${company.state}`)} union all ${ofCompanies(sql`${company.city}`)}`;
      break;
    case "industry":
      source = base(sql`${company.industry}`);
      break;
    case "keywords":
      source = base(sql`unnest(${company.keywords})`);
      break;
    case "technologies":
      source = base(sql`unnest(${company.technologies})`);
      break;
    case "company":
      source = ofCompanies(sql`${company.name}`);
      break;
    case "source":
      source = entity === "contact" ? ofContacts(sql`${contact.source}`) : ofCompanies(sql`${company.source}`);
      break;
  }
  const result = await db.execute<{ v: string; n: number }>(sql`
    select v, count(*)::int as n from (${source}) as s
    where v is not null and v <> '' ${q ? sql`and v ilike ${pattern}` : sql``}
    group by v order by n desc, v asc limit ${limit}`);
  return result.rows.map((r) => ({ value: r.v, count: Number(r.n) }));
}

export interface QuickFilters {
  locations: FacetValue[];
  titles: FacetValue[];
  industries: FacetValue[];
  employeeRanges: FacetValue[];
}

/** Chips for the empty state, from the workspace's own data. */
export async function quickFilters(actor: Actor, entity: SearchEntity): Promise<QuickFilters> {
  const [locations, titles, industries] = await Promise.all([
    filterValues(actor, entity, "location", "", 6),
    entity === "contact" ? filterValues(actor, entity, "titles", "", 6) : Promise.resolve([]),
    filterValues(actor, entity, "industry", "", 6),
  ]);
  const ctx: FilterContext = { organizationId: actor.organizationId, userId: actor.userId, dynamicLists: new Map() };
  const facets = entity === "company" ? await facetCounts("company", {}, ctx) : { employeeRanges: [] };
  return { locations, titles, industries, employeeRanges: facets.employeeRanges.slice(0, 6) };
}

/** Recent CSV import batches (from the audit log) for the "CSV import" filter. */
export async function importBatchOptions(
  actor: Actor,
  entity: SearchEntity,
): Promise<{ id: string; label: string; createdAt: string }[]> {
  const rows = await db
    .select({ metadata: schema.auditLog.metadata, createdAt: schema.auditLog.createdAt })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.organizationId, actor.organizationId),
        eq(schema.auditLog.action, entity === "contact" ? "contact.import" : "company.import"),
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(50);
  return rows.flatMap((r) => {
    const batchId = r.metadata?.batchId;
    if (typeof batchId !== "string") return [];
    const fileName = typeof r.metadata?.fileName === "string" ? r.metadata.fileName : "CSV import";
    return [
      {
        id: batchId,
        label: `${fileName} · ${r.createdAt.toISOString().slice(0, 10)}`,
        createdAt: r.createdAt.toISOString(),
      },
    ];
  });
}

/** Total / Net new / Saved counts plus facet counts for the current filters. */
export async function searchCounts(
  actor: Actor,
  entity: SearchEntity,
  f: PeopleFilters | CompanyFilters,
): Promise<{ segment_counts: SegmentCounts; facets: Facets }> {
  const ctx = await resolveFilterContext(actor, entity, f);
  const [segments, facets] = await Promise.all([segmentCounts(entity, f, ctx), facetCounts(entity, f, ctx)]);
  return { segment_counts: segments, facets };
}
