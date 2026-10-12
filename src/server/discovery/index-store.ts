import "server-only";

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import { db, schema } from "@/server/db";
import { detectPattern, type PatternSample } from "@/server/email/patterns";

import type { AtsJob } from "./ats";
import { departmentFromTitle, employeeRangeFor, seniorityFromTitle, splitFullName } from "./classify";
import type { FeedItem } from "./feeds";
import { isOptedOut } from "./optouts";

/**
 * Writes to the installation-wide discovery index. Everything here comes from public sources
 * (company websites, their feeds and job boards, Wikidata); nothing is ever read from a
 * workspace's own records. Every company keeps its provenance in `sources`.
 */

export interface SourceEntry {
  /** "crawl", "wikidata", "rss", "ats:greenhouse", "domain_list", "manual"… */
  source: string;
  url: string;
  retrievedAt: string;
  fields: string[];
  license?: string;
}

export interface CompanyPatch {
  name?: string | null;
  websiteUrl?: string | null;
  description?: string | null;
  industry?: string | null;
  keywords?: string[];
  technologies?: string[];
  employeeCount?: number | null;
  foundedYear?: number | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  emailPattern?: string | null;
}

type CompanyRow = typeof schema.indexCompany.$inferSelect;

const MAX_SOURCES = 30;

function isSourceEntry(value: unknown): value is SourceEntry {
  return typeof value === "object" && value !== null && "source" in value && "url" in value;
}

function mergeSources(existing: unknown[], entry: SourceEntry): SourceEntry[] {
  const list = existing.filter(isSourceEntry).filter((s) => !(s.source === entry.source && s.url === entry.url));
  return [entry, ...list].slice(0, MAX_SOURCES);
}

const SCALAR_FIELDS = [
  "name",
  "websiteUrl",
  "description",
  "industry",
  "employeeCount",
  "foundedYear",
  "country",
  "region",
  "city",
  "phone",
  "linkedinUrl",
  "twitterUrl",
  "emailPattern",
] as const;

/**
 * Create or update the company for a domain. Empty fields are filled; existing values are kept
 * unless `overwrite` lists the field (a better source for it, e.g. Wikidata for the head count).
 * Keywords and technologies are merged. Returns null when the domain is opted out.
 */
export async function upsertIndexCompany(
  domain: string,
  patch: CompanyPatch,
  source: SourceEntry,
  options: { overwrite?: Array<(typeof SCALAR_FIELDS)[number]>; crawled?: boolean } = {},
): Promise<CompanyRow | null> {
  if (await isOptedOut({ domain })) return null;
  return db.transaction(async (tx) => {
    await tx.insert(schema.indexCompany).values({ domain }).onConflictDoNothing();
    const [existing] = await tx
      .select()
      .from(schema.indexCompany)
      .where(eq(schema.indexCompany.domain, domain))
      .for("update")
      .limit(1);
    if (!existing) return null;
    const update: Partial<typeof schema.indexCompany.$inferInsert> = {};
    const overwrite = new Set(options.overwrite ?? []);
    for (const field of SCALAR_FIELDS) {
      const value = patch[field];
      if (value === undefined || value === null || value === "") continue;
      if (existing[field] === null || existing[field] === undefined || overwrite.has(field)) {
        (update as Record<string, unknown>)[field] = value;
      }
    }
    if (update.employeeCount !== undefined) update.employeeRange = employeeRangeFor(update.employeeCount);
    if (patch.keywords?.length) {
      update.keywords = [...new Set([...existing.keywords, ...patch.keywords.map((k) => k.toLowerCase())])].slice(
        0,
        50,
      );
    }
    if (patch.technologies?.length) {
      update.technologies = [...new Set([...existing.technologies, ...patch.technologies])].slice(0, 100);
    }
    update.sources = mergeSources(existing.sources, source);
    if (options.crawled) update.lastCrawledAt = new Date();
    const [row] = await tx
      .update(schema.indexCompany)
      .set(update)
      .where(eq(schema.indexCompany.id, existing.id))
      .returning();
    return row ?? existing;
  });
}

export async function indexCompanyByDomain(domain: string): Promise<CompanyRow | null> {
  const [row] = await db.select().from(schema.indexCompany).where(eq(schema.indexCompany.domain, domain)).limit(1);
  return row ?? null;
}

export interface PersonInput {
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
}

/**
 * Record the people listed on one page. People seen again are refreshed (and un-marked as gone);
 * people this page listed before but not any more get `goneAt` (a likely job change). Opted-out
 * people and addresses are never written. Returns how many were written and marked gone.
 */
export async function recordPagePeople(
  company: CompanyRow,
  sourceUrl: string,
  people: PersonInput[],
): Promise<{ written: number; gone: number }> {
  const now = new Date();
  const kept: string[] = [];
  let written = 0;
  for (const p of people.slice(0, 200)) {
    const fullName = p.name.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!fullName) continue;
    if (await isOptedOut({ domain: company.domain, fullName, email: p.email })) continue;
    const split =
      p.firstName || p.lastName ? { firstName: p.firstName, lastName: p.lastName } : splitFullName(fullName);
    const title = p.title?.slice(0, 200) ?? null;
    await db
      .insert(schema.indexPerson)
      .values({
        companyId: company.id,
        fullName,
        firstName: split.firstName,
        lastName: split.lastName,
        title,
        seniority: seniorityFromTitle(title),
        department: departmentFromTitle(title),
        publishedEmail: p.email,
        sourceUrl,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.indexPerson.companyId, schema.indexPerson.fullName],
        set: {
          title: sql`coalesce(excluded.title, ${schema.indexPerson.title})`,
          seniority: sql`coalesce(excluded.seniority, ${schema.indexPerson.seniority})`,
          department: sql`coalesce(excluded.department, ${schema.indexPerson.department})`,
          publishedEmail: sql`coalesce(excluded.published_email, ${schema.indexPerson.publishedEmail})`,
          sourceUrl,
          lastSeenAt: now,
          goneAt: null,
        },
      });
    kept.push(fullName);
    written += 1;
  }
  const gone = await db
    .update(schema.indexPerson)
    .set({ goneAt: now })
    .where(
      and(
        eq(schema.indexPerson.companyId, company.id),
        eq(schema.indexPerson.sourceUrl, sourceUrl),
        isNull(schema.indexPerson.goneAt),
        kept.length ? notInArray(schema.indexPerson.fullName, kept) : undefined,
      ),
    )
    .returning({ id: schema.indexPerson.id });
  return { written, gone: gone.length };
}

/**
 * Detect the company's address format from published addresses that belong to named people
 * (src/server/email/patterns.ts). Saved when at least two agree or one fits with good confidence.
 */
export async function refreshEmailPattern(company: CompanyRow, extra: PatternSample[] = []): Promise<string | null> {
  const rows = await db
    .select({
      firstName: schema.indexPerson.firstName,
      lastName: schema.indexPerson.lastName,
      email: schema.indexPerson.publishedEmail,
    })
    .from(schema.indexPerson)
    .where(and(eq(schema.indexPerson.companyId, company.id), isNotNull(schema.indexPerson.publishedEmail)))
    .limit(200);
  const samples: PatternSample[] = [
    ...rows.flatMap((r) => (r.email ? [{ firstName: r.firstName, lastName: r.lastName, email: r.email }] : [])),
    ...extra,
  ];
  const detected = detectPattern(samples);
  if (!detected || detected.confidence < 0.5) return null;
  if (detected.pattern !== company.emailPattern) {
    await db
      .update(schema.indexCompany)
      .set({ emailPattern: detected.pattern })
      .where(eq(schema.indexCompany.id, company.id));
  }
  return detected.pattern;
}

/** Upsert the postings read from one job board; returns how many were written. */
export async function recordJobs(company: CompanyRow, source: string, jobs: AtsJob[]): Promise<number> {
  const now = new Date();
  let written = 0;
  for (const job of jobs) {
    await db
      .insert(schema.indexJobPosting)
      .values({
        companyId: company.id,
        title: job.title.slice(0, 300),
        department: job.department,
        location: job.location,
        url: job.url,
        source,
        postedAt: job.postedAt,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: schema.indexJobPosting.url,
        set: {
          title: job.title.slice(0, 300),
          department: job.department,
          location: job.location,
          postedAt: job.postedAt,
          lastSeenAt: now,
        },
        // Never move a posting from one company to another.
        setWhere: eq(schema.indexJobPosting.companyId, company.id),
      });
    written += 1;
  }
  return written;
}

/** Insert feed items not yet known (by URL). Returns how many were new. */
export async function recordNews(company: CompanyRow, source: string, items: FeedItem[]): Promise<number> {
  if (!items.length) return 0;
  const inserted = await db
    .insert(schema.indexNews)
    .values(
      items.slice(0, 50).map((item) => ({
        companyId: company.id,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        source,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.indexNews.id });
  return inserted.length;
}

/** People not seen for `days` days are deleted (retention). Returns how many. */
export async function deleteStalePeople(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(schema.indexPerson)
    .where(sql`${schema.indexPerson.lastSeenAt} < ${cutoff}`)
    .returning({ id: schema.indexPerson.id });
  return removed.length;
}

/** Index rows for these ids (helper for the save paths). */
export async function indexCompaniesByIds(ids: string[]): Promise<CompanyRow[]> {
  if (!ids.length) return [];
  return db.select().from(schema.indexCompany).where(inArray(schema.indexCompany.id, ids));
}
