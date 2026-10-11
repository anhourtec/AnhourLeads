import "server-only";

import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import { SENIORITIES, type Seniority } from "@/lib/records-vocabulary";
import { EMPLOYEE_RANGE_KEYS, EMPLOYEE_RANGES } from "@/lib/search/filters";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { bareDomain } from "@/server/discovery/classify";
import {
  companyNotOptedOutSql,
  isOptedOut as isOptedOutInIndex,
  type OptoutQuery,
  personNotOptedOutSql,
} from "@/server/discovery/optouts";
import { HttpError, notFound } from "@/server/http/errors";

import { audit } from "./audit";
import { matchPerson } from "./enrichment";
import { suppressionChecker } from "./enrichment-common";
import { recordEvent } from "./events";
import { defaultOwner, likePattern, optionalBool, optionalInt, stringList } from "./records";

/**
 * The installation-wide discovery index, as workspaces see it: search people and companies built
 * from public sources, see which ones the workspace already holds (net new / saved), copy the
 * chosen ones into the workspace with provenance, and find a saved person's email on demand.
 *
 * The index is shared by every workspace and never contains anything from a workspace's own
 * records. Opted-out domains, people and addresses are excluded everywhere.
 */

const { indexCompany: ic, indexPerson: ip, indexJobPosting: ij, indexNews: inews, company, contact } = schema;

/** Callers outside discovery (the sending engine) ask this before emailing anyone. */
export async function isOptedOut(query: OptoutQuery): Promise<boolean> {
  return isOptedOutInIndex(query);
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

const textList = (max = 50, itemMax = 200) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .transform((v) => [...new Set(v.map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(itemMax)).max(max))
    .optional();

const companyShape = {
  q: z.string().trim().max(200).optional(),
  country: textList(),
  city: textList(),
  location: textList(),
  locationExclude: textList(),
  /** Company name contains any of these. */
  companies: textList(),
  companiesExclude: textList(),
  industry: textList(),
  industryExclude: textList(),
  keywords: textList(),
  keywordsExclude: textList(),
  technologies: textList(),
  employeeRanges: z
    .union([z.enum(EMPLOYEE_RANGE_KEYS), z.array(z.enum(EMPLOYEE_RANGE_KEYS))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  employeesMin: optionalInt(0, 10_000_000),
  employeesMax: optionalInt(0, 10_000_000),
  /** Also match companies whose size is unknown (combined with the size filters by "or"). */
  employeesUnknown: optionalBool,
  foundedMin: optionalInt(1000, 3000),
  foundedMax: optionalInt(1000, 3000),
  /** Job postings seen in the last 30 days. */
  hiring: optionalBool,
  /** People with an address the company published itself. */
  hasEmail: optionalBool,
  domains: stringList(100, 300),
  domainsExclude: stringList(100, 300),
  segment: z.enum(["total", "net_new", "saved"]).optional(),
  sortAscending: optionalBool,
  page: z.unknown().optional(),
  per_page: z.unknown().optional(),
  perPage: z.unknown().optional(),
};

export const indexCompanySearchInput = z.strictObject({
  ...companyShape,
  sortBy: z.enum(["relevance", "name", "employeeCount", "foundedYear", "lastCrawledAt"]).optional(),
});

export const indexPeopleSearchInput = z.strictObject({
  ...companyShape,
  /** Person name contains. */
  name: z.string().trim().max(200).optional(),
  titles: textList(),
  titlesExclude: textList(),
  /** Same as location (the index places people at their company). */
  companyLocation: textList(),
  seniority: z
    .union([z.enum(SENIORITIES), z.array(z.enum(SENIORITIES))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  department: textList(),
  /** Include people no longer listed on their source page (default: only current). */
  includeGone: optionalBool,
  sortBy: z.enum(["relevance", "name", "title", "company", "lastSeenAt"]).optional(),
});

export type IndexCompanyFilters = z.infer<typeof indexCompanySearchInput>;
export type IndexPeopleFilters = z.infer<typeof indexPeopleSearchInput>;

const lowerIn = (column: SQL | AnyColumn, values: string[]) =>
  inArray(
    sql`lower(${column})`,
    values.map((v) => v.toLowerCase()),
  );

const anyLike = (column: SQL | AnyColumn, values: string[]) =>
  or(...values.map((v) => sql`${column} ilike ${likePattern(v)}`)) as SQL;

/**
 * Correlated subqueries name the outer index tables explicitly: in a single-table selection
 * drizzle renders columns unqualified, which would bind them to the subquery's own table.
 */
const IC_ID = sql.raw(`"index_company"."id"`);
const IC_DOMAIN = sql.raw(`"index_company"."domain"`);
const IP_EMAIL = sql.raw(`"index_person"."published_email"`);
const IP_NAME = sql.raw(`"index_person"."full_name"`);
const domainOnly = sql`split_part(${IC_DOMAIN}, ':', 1)`;

function normalizedDomains(values: string[]): string[] {
  return values.map((v) =>
    bareDomain(
      v
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, "")
        .split(/[/?#]/)[0] ?? "",
    ),
  );
}

/** Workspace already holds this index company (same domain). */
function companySavedSql(organizationId: string): SQL {
  return sql`(select w.id from ${company} w where w.organization_id = ${organizationId} and w.domain = ${domainOnly} limit 1)`;
}

/** Workspace already holds this index person (same published address, or same name at the same company domain). */
function personSavedSql(organizationId: string): SQL {
  return sql`(select ct.id from ${contact} ct
    where ct.organization_id = ${organizationId}
      and ((${IP_EMAIL} is not null and ct.email = lower(${IP_EMAIL}))
        or (lower(trim(concat_ws(' ', ct.first_name, ct.last_name))) = lower(${IP_NAME})
          and ct.company_id in (select w.id from ${company} w where w.organization_id = ${organizationId} and w.domain = ${domainOnly})))
    limit 1)`;
}

/** City, region or country contains any of the values. */
const placeLike = (values: string[]) =>
  or(
    ...values.map((l) =>
      or(
        sql`${ic.city} ilike ${likePattern(l)}`,
        sql`${ic.region} ilike ${likePattern(l)}`,
        sql`${ic.country} ilike ${likePattern(l)}`,
      ),
    ),
  ) as SQL;

const keywordMatch = (values: string[]) =>
  or(
    sql`${ic.keywords} && ${sql`array[${sql.join(
      values.map((k) => sql`${k.toLowerCase()}`),
      sql`, `,
    )}]::text[]`}`,
    ...values.map((k) => sql`${ic.description} ilike ${likePattern(k)}`),
    ...values.map((k) => sql`${ic.name} ilike ${likePattern(k)}`),
  ) as SQL;

function companyConditions(f: Omit<IndexCompanyFilters, "sortBy">, organizationId: string, forPeople: boolean): SQL[] {
  const out: SQL[] = [companyNotOptedOutSql()];
  if (f.q && !forPeople)
    out.push(or(sql`${ic.name} ilike ${likePattern(f.q)}`, sql`${ic.domain} ilike ${likePattern(f.q)}`) as SQL);
  if (f.country?.length) out.push(lowerIn(ic.country, f.country));
  if (f.city?.length) out.push(lowerIn(ic.city, f.city));
  if (f.location?.length) out.push(placeLike(f.location));
  if (f.locationExclude?.length) out.push(sql`not coalesce(${placeLike(f.locationExclude)}, false)`);
  if (f.companies?.length) out.push(anyLike(ic.name, f.companies));
  if (f.companiesExclude?.length) out.push(sql`not coalesce(${anyLike(ic.name, f.companiesExclude)}, false)`);
  if (f.industry?.length) out.push(anyLike(ic.industry, f.industry));
  if (f.industryExclude?.length) out.push(sql`not coalesce(${anyLike(ic.industry, f.industryExclude)}, false)`);
  if (f.keywords?.length) out.push(keywordMatch(f.keywords));
  if (f.keywordsExclude?.length) out.push(sql`not coalesce(${keywordMatch(f.keywordsExclude)}, false)`);
  if (f.technologies?.length) {
    const lowered = f.technologies.map((t) => t.toLowerCase());
    out.push(
      sql`exists (select 1 from unnest(${ic.technologies}) t where lower(t) in (${sql.join(
        lowered.map((t) => sql`${t}`),
        sql`, `,
      )}))`,
    );
  }
  // Size: any chosen range, the min/max window, or unknown size (as in workspace search).
  const size: SQL[] = EMPLOYEE_RANGES.filter((r) => f.employeeRanges?.includes(r.key)).map((r) =>
    r.max === null ? sql`${ic.employeeCount} >= ${r.min}` : sql`${ic.employeeCount} between ${r.min} and ${r.max}`,
  );
  if (f.employeesMin !== undefined || f.employeesMax !== undefined) {
    size.push(
      and(
        f.employeesMin !== undefined ? sql`${ic.employeeCount} >= ${f.employeesMin}` : undefined,
        f.employeesMax !== undefined ? sql`${ic.employeeCount} <= ${f.employeesMax}` : undefined,
      ) as SQL,
    );
  }
  if (f.employeesUnknown) size.push(isNull(ic.employeeCount) as SQL);
  if (size.length) out.push(or(...size) as SQL);
  if (f.foundedMin !== undefined) out.push(sql`${ic.foundedYear} >= ${f.foundedMin}`);
  if (f.foundedMax !== undefined) out.push(sql`${ic.foundedYear} <= ${f.foundedMax}`);
  if (f.hiring !== undefined) {
    const hiring = sql`exists (select 1 from ${ij} j where j.company_id = ${IC_ID} and j.last_seen_at > now() - interval '30 days')`;
    out.push(f.hiring ? hiring : sql`not ${hiring}`);
  }
  if (f.hasEmail !== undefined && !forPeople) {
    const has = sql`exists (select 1 from ${ip} p where p.company_id = ${IC_ID} and p.published_email is not null and p.gone_at is null)`;
    out.push(f.hasEmail ? has : sql`not ${has}`);
  }
  if (f.domains?.length) out.push(inArray(domainOnly, normalizedDomains(f.domains)));
  if (f.domainsExclude?.length) out.push(not(inArray(domainOnly, normalizedDomains(f.domainsExclude))));
  if (!forPeople && f.segment === "net_new") out.push(sql`${companySavedSql(organizationId)} is null`);
  if (!forPeople && f.segment === "saved") out.push(sql`${companySavedSql(organizationId)} is not null`);
  return out;
}

function peopleConditions(f: IndexPeopleFilters, organizationId: string): SQL[] {
  const out = companyConditions(f, organizationId, true);
  out.push(personNotOptedOutSql());
  if (!f.includeGone) out.push(isNull(ip.goneAt) as SQL);
  if (f.q)
    out.push(
      or(
        sql`${ip.fullName} ilike ${likePattern(f.q)}`,
        sql`${ip.title} ilike ${likePattern(f.q)}`,
        sql`${ic.name} ilike ${likePattern(f.q)}`,
      ) as SQL,
    );
  if (f.name) out.push(sql`${ip.fullName} ilike ${likePattern(f.name)}`);
  if (f.companyLocation?.length) out.push(placeLike(f.companyLocation));
  if (f.titles?.length) out.push(anyLike(sql`${ip.title}`, f.titles));
  if (f.titlesExclude?.length) out.push(sql`not coalesce(${anyLike(sql`${ip.title}`, f.titlesExclude)}, false)`);
  if (f.seniority?.length) out.push(inArray(ip.seniority, f.seniority));
  if (f.department?.length) out.push(lowerIn(sql`${ip.department}`, f.department));
  if (f.hasEmail !== undefined)
    out.push(f.hasEmail ? (isNotNull(ip.publishedEmail) as SQL) : (isNull(ip.publishedEmail) as SQL));
  if (f.segment === "net_new") out.push(sql`${personSavedSql(organizationId)} is null`);
  if (f.segment === "saved") out.push(sql`${personSavedSql(organizationId)} is not null`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

export interface IndexCompanyRef {
  id: string;
  name: string | null;
  domain: string;
  websiteUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  country: string | null;
  city: string | null;
}

export interface IndexPersonView {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  /** The company published an address for this person; it is revealed when saved ("Access email"). */
  emailAvailable: boolean;
  sourceUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  goneAt: string | null;
  company: IndexCompanyRef;
  /** The workspace contact this person matches, if any. */
  savedContactId: string | null;
  netNew: boolean;
}

export interface IndexCompanyView extends IndexCompanyRef {
  description: string | null;
  keywords: string[];
  technologies: string[];
  foundedYear: number | null;
  region: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  emailPattern: string | null;
  peopleCount: number;
  jobCount: number;
  hiring: boolean;
  lastCrawledAt: string | null;
  firstSeenAt: string;
  savedCompanyId: string | null;
  netNew: boolean;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

const companyRefColumns = {
  id: ic.id,
  name: ic.name,
  domain: ic.domain,
  websiteUrl: ic.websiteUrl,
  industry: ic.industry,
  employeeCount: ic.employeeCount,
  employeeRange: ic.employeeRange,
  country: ic.country,
  city: ic.city,
};

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export async function searchIndexCompanies(
  actor: Actor,
  filters: IndexCompanyFilters,
  page: { perPage: number; offset: number },
): Promise<{ companies: IndexCompanyView[]; total: number }> {
  const where = and(...companyConditions(filters, actor.organizationId, false));
  const peopleCount = sql<number>`(select count(*)::int from ${ip} p where p.company_id = ${IC_ID} and p.gone_at is null)`;
  const jobCount = sql<number>`(select count(*)::int from ${ij} j where j.company_id = ${IC_ID} and j.last_seen_at > now() - interval '30 days')`;
  const dir = filters.sortAscending ? asc : desc;
  const order: SQL[] = (() => {
    switch (filters.sortBy) {
      case "name":
        return [filters.sortAscending === false ? sql`${ic.name} desc nulls last` : sql`${ic.name} asc nulls last`];
      case "employeeCount":
        return [sql`${ic.employeeCount} ${filters.sortAscending ? sql`asc` : sql`desc`} nulls last`];
      case "foundedYear":
        return [sql`${ic.foundedYear} ${filters.sortAscending ? sql`asc` : sql`desc`} nulls last`];
      case "lastCrawledAt":
        return [dir(ic.lastCrawledAt)];
      default:
        return [sql`${peopleCount} desc`, sql`${ic.name} asc nulls last`];
    }
  })();
  const [rows, [total]] = await Promise.all([
    db
      .select({
        ...companyRefColumns,
        description: ic.description,
        keywords: ic.keywords,
        technologies: ic.technologies,
        foundedYear: ic.foundedYear,
        region: ic.region,
        phone: ic.phone,
        linkedinUrl: ic.linkedinUrl,
        twitterUrl: ic.twitterUrl,
        emailPattern: ic.emailPattern,
        lastCrawledAt: ic.lastCrawledAt,
        firstSeenAt: ic.firstSeenAt,
        peopleCount,
        jobCount,
        savedId: sql<string | null>`${companySavedSql(actor.organizationId)}`,
      })
      .from(ic)
      .where(where)
      .orderBy(...order, asc(ic.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(ic).where(where),
  ]);
  return {
    companies: rows.map((r) => ({
      ...r,
      peopleCount: Number(r.peopleCount),
      jobCount: Number(r.jobCount),
      hiring: Number(r.jobCount) > 0,
      lastCrawledAt: iso(r.lastCrawledAt),
      firstSeenAt: iso(r.firstSeenAt) ?? "",
      savedCompanyId: r.savedId,
      netNew: !r.savedId,
    })),
    total: Number(total?.n ?? 0),
  };
}

export async function searchIndexPeople(
  actor: Actor,
  filters: IndexPeopleFilters,
  page: { perPage: number; offset: number },
): Promise<{ people: IndexPersonView[]; total: number }> {
  const where = and(...peopleConditions(filters, actor.organizationId));
  const asc_ = filters.sortAscending !== false;
  const order: SQL[] = (() => {
    switch (filters.sortBy) {
      case "name":
        return [asc_ ? asc(ip.fullName) : desc(ip.fullName)];
      case "title":
        return [sql`${ip.title} ${asc_ ? sql`asc` : sql`desc`} nulls last`];
      case "company":
        return [sql`${ic.name} ${asc_ ? sql`asc` : sql`desc`} nulls last`];
      case "lastSeenAt":
        return [filters.sortAscending ? asc(ip.lastSeenAt) : desc(ip.lastSeenAt)];
      default: {
        // Leaders first, then the most recently confirmed.
        const rank = sql`case ${ip.seniority} when 'founder' then 0 when 'owner' then 0 when 'c_suite' then 1 when 'partner' then 2 when 'vp' then 3 when 'head' then 4 when 'director' then 5 when 'manager' then 6 when 'senior' then 7 when 'entry' then 8 else 9 end`;
        return [rank, desc(ip.lastSeenAt)];
      }
    }
  })();
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: ip.id,
        name: ip.fullName,
        firstName: ip.firstName,
        lastName: ip.lastName,
        title: ip.title,
        seniority: ip.seniority,
        department: ip.department,
        publishedEmail: ip.publishedEmail,
        sourceUrl: ip.sourceUrl,
        firstSeenAt: ip.firstSeenAt,
        lastSeenAt: ip.lastSeenAt,
        goneAt: ip.goneAt,
        company: companyRefColumns,
        savedId: sql<string | null>`${personSavedSql(actor.organizationId)}`,
      })
      .from(ip)
      .innerJoin(ic, eq(ic.id, ip.companyId))
      .where(where)
      .orderBy(...order, asc(ip.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(ip).innerJoin(ic, eq(ic.id, ip.companyId)).where(where),
  ]);
  return {
    people: rows.map(({ publishedEmail, savedId, ...r }) => ({
      ...r,
      emailAvailable: Boolean(publishedEmail),
      firstSeenAt: iso(r.firstSeenAt) ?? "",
      lastSeenAt: iso(r.lastSeenAt) ?? "",
      goneAt: iso(r.goneAt),
      savedContactId: savedId,
      netNew: !savedId,
    })),
    total: Number(total?.n ?? 0),
  };
}

export interface IndexSegmentCounts {
  total: number;
  net_new: number;
  /** Index rows this workspace already holds. */
  saved: number;
}

/** Total / Net new / Saved over the index under the filters (the segment itself ignored), in one query. */
export async function indexSegmentCounts(
  actor: Actor,
  entity: "contact" | "company",
  filters: IndexPeopleFilters | IndexCompanyFilters,
): Promise<IndexSegmentCounts> {
  const f = { ...filters, segment: undefined };
  if (entity === "company") {
    const saved = sql`${companySavedSql(actor.organizationId)} is not null`;
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        saved: sql<number>`(count(*) filter (where ${saved}))::int`,
      })
      .from(ic)
      .where(and(...companyConditions(f, actor.organizationId, false)));
    const total = Number(row?.total ?? 0);
    const savedN = Number(row?.saved ?? 0);
    return { total, net_new: total - savedN, saved: savedN };
  }
  const saved = sql`${personSavedSql(actor.organizationId)} is not null`;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      saved: sql<number>`(count(*) filter (where ${saved}))::int`,
    })
    .from(ip)
    .innerJoin(ic, eq(ic.id, ip.companyId))
    .where(and(...peopleConditions(f as IndexPeopleFilters, actor.organizationId)));
  const total = Number(row?.total ?? 0);
  const savedN = Number(row?.saved ?? 0);
  return { total, net_new: total - savedN, saved: savedN };
}

/** Whether the index holds anything searchable at all (decides the default tab and the empty state). */
export async function indexHasRows(entity: "contact" | "company"): Promise<boolean> {
  const rows =
    entity === "company"
      ? await db.select({ id: ic.id }).from(ic).limit(1)
      : await db.select({ id: ip.id }).from(ip).where(isNull(ip.goneAt)).limit(1);
  return rows.length > 0;
}

/**
 * Which index rows the workspace already holds: index id → workspace record id (or null when net
 * new). Companies match by domain; people by published address, or by name at the same company domain.
 */
export async function netNewForWorkspace(
  organizationId: string,
  ids: { companyIds?: string[]; personIds?: string[] },
): Promise<{ companies: Map<string, string | null>; people: Map<string, string | null> }> {
  const companies = new Map<string, string | null>();
  const people = new Map<string, string | null>();
  if (ids.companyIds?.length) {
    const rows = await db
      .select({ id: ic.id, saved: sql<string | null>`${companySavedSql(organizationId)}` })
      .from(ic)
      .where(inArray(ic.id, ids.companyIds));
    for (const r of rows) companies.set(r.id, r.saved);
  }
  if (ids.personIds?.length) {
    const rows = await db
      .select({ id: ip.id, saved: sql<string | null>`${personSavedSql(organizationId)}` })
      .from(ip)
      .innerJoin(ic, eq(ic.id, ip.companyId))
      .where(inArray(ip.id, ids.personIds));
    for (const r of rows) people.set(r.id, r.saved);
  }
  return { companies, people };
}

/* -------------------------------------------------------------------------- */
/* Company detail                                                             */
/* -------------------------------------------------------------------------- */

export async function getIndexCompany(actor: Actor, id: string) {
  const [row] = await db
    .select({ company: ic, savedId: sql<string | null>`${companySavedSql(actor.organizationId)}` })
    .from(ic)
    .where(and(eq(ic.id, id), companyNotOptedOutSql()))
    .limit(1);
  if (!row) throw notFound("Company not found.");
  const c = row.company;
  const [people, jobs, news] = await Promise.all([
    db
      .select({
        id: ip.id,
        name: ip.fullName,
        title: ip.title,
        seniority: ip.seniority,
        department: ip.department,
        publishedEmail: ip.publishedEmail,
        sourceUrl: ip.sourceUrl,
        lastSeenAt: ip.lastSeenAt,
        goneAt: ip.goneAt,
        savedId: sql<string | null>`${personSavedSql(actor.organizationId)}`,
      })
      .from(ip)
      .innerJoin(ic, eq(ic.id, ip.companyId))
      .where(and(eq(ip.companyId, c.id), personNotOptedOutSql()))
      .orderBy(sql`${ip.goneAt} nulls first`, asc(ip.fullName))
      .limit(200),
    db.select().from(ij).where(eq(ij.companyId, c.id)).orderBy(desc(ij.lastSeenAt), asc(ij.title)).limit(200),
    db
      .select()
      .from(inews)
      .where(eq(inews.companyId, c.id))
      .orderBy(sql`${inews.publishedAt} desc nulls last`)
      .limit(50),
  ]);
  const recentJobs = jobs.filter((j) => j.lastSeenAt.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000);
  return {
    company: {
      id: c.id,
      name: c.name,
      domain: c.domain,
      websiteUrl: c.websiteUrl,
      description: c.description,
      industry: c.industry,
      keywords: c.keywords,
      technologies: c.technologies,
      employeeCount: c.employeeCount,
      employeeRange: c.employeeRange,
      foundedYear: c.foundedYear,
      country: c.country,
      region: c.region,
      city: c.city,
      phone: c.phone,
      linkedinUrl: c.linkedinUrl,
      twitterUrl: c.twitterUrl,
      emailPattern: c.emailPattern,
      hiring: recentJobs.length > 0,
      firstSeenAt: c.firstSeenAt.toISOString(),
      lastCrawledAt: iso(c.lastCrawledAt),
      savedCompanyId: row.savedId,
      netNew: !row.savedId,
    },
    people: people.map(({ publishedEmail, savedId, ...p }) => ({
      ...p,
      emailAvailable: Boolean(publishedEmail),
      lastSeenAt: p.lastSeenAt.toISOString(),
      goneAt: iso(p.goneAt),
      savedContactId: savedId,
      netNew: !savedId,
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      department: j.department,
      location: j.location,
      url: j.url,
      source: j.source,
      postedAt: iso(j.postedAt),
      lastSeenAt: j.lastSeenAt.toISOString(),
    })),
    news: news.map((n) => ({
      id: n.id,
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: iso(n.publishedAt),
      firstSeenAt: n.firstSeenAt.toISOString(),
    })),
    provenance: c.sources,
  };
}

/* -------------------------------------------------------------------------- */
/* Save to workspace                                                          */
/* -------------------------------------------------------------------------- */

export const saveInput = z.strictObject({
  ids: z
    .array(z.string().trim().min(1).max(128))
    .min(1, "Choose at least one record.")
    .max(100, "Save at most 100 at a time."),
});

export const accessEmailInput = z.strictObject({ id: z.string().trim().min(1).max(128) });

const SOURCE = "discovery_index";

interface SourceEntryLike {
  source?: unknown;
  url?: unknown;
  fields?: unknown;
}

/** The URL a field's value came from (the newest source that lists it), else the website. */
function sourceUrlFor(row: typeof ic.$inferSelect, field: string): string | null {
  for (const s of row.sources as SourceEntryLike[]) {
    if (Array.isArray(s?.fields) && s.fields.includes(field) && typeof s.url === "string") return s.url;
  }
  const first = (row.sources as SourceEntryLike[]).find((s) => typeof s?.url === "string");
  return (typeof first?.url === "string" ? first.url : null) ?? row.websiteUrl;
}

type ProvenanceInsert = typeof schema.fieldProvenance.$inferInsert;

async function insertProvenance(rows: ProvenanceInsert[]): Promise<void> {
  if (rows.length) await db.insert(schema.fieldProvenance).values(rows);
}

/** Copy one index company into the workspace (or find the one it already has). */
async function saveCompanyRow(
  actor: Actor,
  row: typeof ic.$inferSelect,
): Promise<{ companyId: string; created: boolean }> {
  const domain = bareDomain(row.domain);
  const [existing] = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.organizationId, actor.organizationId), eq(company.domain, domain)))
    .limit(1);
  if (existing) return { companyId: existing.id, created: false };
  const fields = {
    name: row.name ?? domain,
    domain,
    websiteUrl: row.websiteUrl ?? `https://${domain}`,
    description: row.description,
    industry: row.industry,
    keywords: row.keywords,
    technologies: row.technologies,
    employeeCount: row.employeeCount,
    foundedYear: row.foundedYear,
    city: row.city,
    state: row.region,
    country: row.country,
    phone: row.phone,
    linkedinUrl: row.linkedinUrl,
    twitterUrl: row.twitterUrl,
    emailPattern: row.emailPattern,
  };
  const inserted = await db
    .insert(company)
    .values({ ...fields, organizationId: actor.organizationId, ownerId: await defaultOwner(actor), source: SOURCE })
    .onConflictDoNothing()
    .returning({ id: company.id });
  const id = inserted[0]?.id;
  if (!id) {
    const [raced] = await db
      .select({ id: company.id })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), eq(company.domain, domain)))
      .limit(1);
    if (!raced) throw new Error("company save failed");
    return { companyId: raced.id, created: false };
  }
  const now = new Date();
  await insertProvenance(
    Object.entries(fields)
      .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
      .map(([field, value]) => ({
        organizationId: actor.organizationId,
        entityType: "company" as const,
        entityId: id,
        field,
        value: Array.isArray(value) ? value.join(", ") : String(value).slice(0, 1000),
        source: SOURCE,
        sourceUrl: sourceUrlFor(row, field === "state" ? "region" : field),
        confidence: 0.8,
        retrievedAt: now,
      })),
  );
  await audit(actor, "company.create", "company", id, { source: SOURCE, indexCompanyId: row.id });
  return { companyId: id, created: true };
}

export interface SaveOutcome {
  saved: Array<{ indexId: string; id: string }>;
  existing: Array<{ indexId: string; id: string }>;
  skipped: Array<{ indexId: string; reason: "not_found" | "opted_out" | "suppressed" | "gone" }>;
}

export async function saveIndexCompanies(actor: Actor, ids: string[]): Promise<SaveOutcome> {
  const unique = [...new Set(ids)];
  const rows = await db
    .select()
    .from(ic)
    .where(and(inArray(ic.id, unique), companyNotOptedOutSql()));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const suppressed = await suppressionChecker(
    actor.organizationId,
    rows.map((r) => bareDomain(r.domain)),
  );
  const out: SaveOutcome = { saved: [], existing: [], skipped: [] };
  for (const id of unique) {
    const row = byId.get(id);
    if (!row) {
      const [exists] = await db.select({ id: ic.id }).from(ic).where(eq(ic.id, id)).limit(1);
      out.skipped.push({ indexId: id, reason: exists ? "opted_out" : "not_found" });
      continue;
    }
    if (suppressed(bareDomain(row.domain))) {
      out.skipped.push({ indexId: id, reason: "suppressed" });
      continue;
    }
    const result = await saveCompanyRow(actor, row);
    (result.created ? out.saved : out.existing).push({ indexId: id, id: result.companyId });
  }
  await audit(actor, "discovery.save_companies", "company", null, {
    saved: out.saved.length,
    existing: out.existing.length,
    skipped: out.skipped.length,
  });
  return out;
}

function seniorityOf(value: string | null): Seniority | null {
  return value && (SENIORITIES as readonly string[]).includes(value) ? (value as Seniority) : null;
}

/** Copy index people into the workspace as contacts, with their company when allowed. */
export async function saveIndexPeople(actor: Actor, ids: string[]): Promise<SaveOutcome> {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ person: ip, company: ic })
    .from(ip)
    .innerJoin(ic, eq(ic.id, ip.companyId))
    .where(and(inArray(ip.id, unique), companyNotOptedOutSql(), personNotOptedOutSql()));
  const byId = new Map(rows.map((r) => [r.person.id, r]));
  const suppressed = await suppressionChecker(actor.organizationId, [
    ...rows.map((r) => bareDomain(r.company.domain)),
    ...rows.flatMap((r) => (r.person.publishedEmail ? [r.person.publishedEmail] : [])),
  ]);
  const mayCreateCompany = can(actor.role, "company:create");
  const out: SaveOutcome = { saved: [], existing: [], skipped: [] };
  for (const id of unique) {
    const found = byId.get(id);
    if (!found) {
      const [exists] = await db.select({ id: ip.id }).from(ip).where(eq(ip.id, id)).limit(1);
      out.skipped.push({ indexId: id, reason: exists ? "opted_out" : "not_found" });
      continue;
    }
    const { person, company: indexCo } = found;
    const email = person.publishedEmail?.toLowerCase() ?? null;
    if (suppressed(bareDomain(indexCo.domain)) || (email && suppressed(email))) {
      out.skipped.push({ indexId: id, reason: "suppressed" });
      continue;
    }
    if (person.goneAt) {
      out.skipped.push({ indexId: id, reason: "gone" });
      continue;
    }

    // Workspace company: existing by domain, or created from the index when the role may.
    const domain = bareDomain(indexCo.domain);
    let companyId: string | null = null;
    const [existingCompany] = await db
      .select({ id: company.id })
      .from(company)
      .where(and(eq(company.organizationId, actor.organizationId), eq(company.domain, domain)))
      .limit(1);
    if (existingCompany) companyId = existingCompany.id;
    else if (mayCreateCompany) companyId = (await saveCompanyRow(actor, indexCo)).companyId;

    // Dedupe: same address, or same name at the same company.
    const fullName = person.fullName.toLowerCase();
    const [dupe] = await db
      .select({ id: contact.id })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, actor.organizationId),
          or(
            email ? eq(contact.email, email) : undefined,
            companyId
              ? and(
                  eq(contact.companyId, companyId),
                  sql`lower(trim(concat_ws(' ', ${contact.firstName}, ${contact.lastName}))) = ${fullName}`,
                )
              : undefined,
          ) ?? sql`false`,
        ),
      )
      .limit(1);
    if (dupe) {
      out.existing.push({ indexId: id, id: dupe.id });
      continue;
    }

    const fields = {
      firstName: person.firstName,
      lastName: person.lastName,
      title: person.title,
      seniority: seniorityOf(person.seniority),
      department: person.department,
      email,
      companyId,
    };
    const inserted = await db
      .insert(contact)
      .values({ ...fields, organizationId: actor.organizationId, ownerId: await defaultOwner(actor), source: SOURCE })
      .onConflictDoNothing()
      .returning({ id: contact.id });
    const contactId = inserted[0]?.id;
    if (!contactId) {
      const [raced] = email
        ? await db
            .select({ id: contact.id })
            .from(contact)
            .where(and(eq(contact.organizationId, actor.organizationId), eq(contact.email, email)))
            .limit(1)
        : [];
      if (raced) out.existing.push({ indexId: id, id: raced.id });
      continue;
    }
    const now = new Date();
    await insertProvenance(
      Object.entries(fields)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([field, value]) => ({
          organizationId: actor.organizationId,
          entityType: "contact" as const,
          entityId: contactId,
          field,
          value: String(value).slice(0, 1000),
          source: SOURCE,
          sourceUrl: person.sourceUrl,
          confidence: field === "email" ? 0.9 : 0.7,
          retrievedAt: now,
        })),
    );
    await audit(actor, "contact.create", "contact", contactId, { source: SOURCE, indexPersonId: id });
    await recordEvent({
      organizationId: actor.organizationId,
      type: "contact_created",
      summary: `${person.fullName} was added from the discovery index`,
      contactId,
      companyId,
      actorUserId: actor.userId,
      metadata: { source: SOURCE, sourceUrl: person.sourceUrl },
    });
    out.saved.push({ indexId: id, id: contactId });
  }
  await audit(actor, "discovery.save_people", "contact", null, {
    saved: out.saved.length,
    existing: out.existing.length,
    skipped: out.skipped.length,
  });
  return out;
}

/**
 * "Access email" for an index person: save them to the workspace (or reuse the saved contact),
 * then run the workspace's own email finding and verification (people/match) for that contact.
 */
export async function accessIndexEmail(actor: Actor, indexPersonId: string) {
  requirePermission(actor, "enrich:run");
  const [person] = await db
    .select({ fullName: ip.fullName, email: ip.publishedEmail, domain: ic.domain })
    .from(ip)
    .innerJoin(ic, eq(ic.id, ip.companyId))
    .where(eq(ip.id, indexPersonId))
    .limit(1);
  if (!person || (await isOptedOutInIndex({ domain: person.domain, fullName: person.fullName, email: person.email }))) {
    throw notFound("Person not found.");
  }
  const [current] = (await netNewForWorkspace(actor.organizationId, { personIds: [indexPersonId] })).people.entries();
  let contactId = current?.[1] ?? null;
  let created = false;
  if (current === undefined) throw notFound("Person not found.");
  if (!contactId) {
    requirePermission(actor, "contact:create");
    const result = await saveIndexPeople(actor, [indexPersonId]);
    const saved = result.saved[0] ?? result.existing[0];
    if (!saved) {
      const reason = result.skipped[0]?.reason ?? "not_found";
      if (reason === "not_found" || reason === "opted_out") throw notFound("Person not found.");
      throw new HttpError(
        409,
        reason === "suppressed"
          ? "This person is on your do-not-contact list."
          : "This person is no longer listed by their company.",
      );
    }
    contactId = saved.id;
    created = result.saved.length > 0;
  }
  const match = await matchPerson(actor, { contactId, verify: true });
  return { contactId, created, person: match.person, credits: match.credits };
}

/** Hiring flag for a set of index companies (job postings in the last 30 days). */
export async function hiringCompanies(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .selectDistinct({ id: ij.companyId })
    .from(ij)
    .where(and(inArray(ij.companyId, ids), gt(ij.lastSeenAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))));
  return new Set(rows.map((r) => r.id));
}
