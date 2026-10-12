import "server-only";

import { and, count, desc, eq, gt, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type Actor, requirePermission } from "@/server/auth/actor";
import { crawlSite, MAX_PAGES } from "@/server/crawler/crawl";
import { hostBlocked } from "@/server/crawler/fetch";
import type { CrawlFindings, CrawlPageRecord, Fact, FactField, FoundPerson } from "@/server/crawler/types";
import { registrableDomain, seedUrlFrom } from "@/server/crawler/url";
import { db, schema } from "@/server/db";
import { EMAIL_STATUSES, type EmailStatus } from "@/server/db/schema";
import { detectPattern, patternsFor } from "@/server/email/patterns";
import { verifyEmail } from "@/server/email/verify";
import { env } from "@/server/env";
import { conflict, HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";
import { log } from "@/server/log";
import { redis } from "@/server/redis";
import { audit } from "@/server/services/audit";

import {
  companyByDomain,
  companyById,
  type FieldOutcome,
  type FieldProposal,
  planFieldUpdates,
  suppressionChecker,
} from "./enrichment-common";
import { randomUUID } from "node:crypto";

/**
 * Public-web research: crawl jobs for company websites and applying what they find to companies
 * and contacts. Every query is scoped by the actor's workspace.
 */

export const CRAWL_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type CrawlStatus = (typeof CRAWL_STATUSES)[number];
const STALE_AFTER_MS = 15 * 60 * 1000;
const LOCK_TTL_MS = 12 * 60 * 1000;
const MAX_VERIFIED_EMAILS = 15;

type CrawlJobRow = typeof schema.crawlJob.$inferSelect;
type CompanyRow = typeof schema.company.$inferSelect;

const invalid = (path: string, message: string) => new HttpError(422, "Some fields are invalid.", [{ path, message }]);

/* -------------------------------------------------------------------------- */
/* Serialisation                                                              */
/* -------------------------------------------------------------------------- */

export function findingsOf(job: Pick<CrawlJobRow, "result">): CrawlFindings | null {
  const r = job.result as Partial<CrawlFindings> | null;
  return r && Array.isArray(r.facts) ? (r as CrawlFindings) : null;
}

function summaryOf(findings: CrawlFindings | null) {
  return findings
    ? {
        emails: findings.emails.length,
        people: findings.people.length,
        technologies: findings.technologies.length,
        social: findings.social.length,
      }
    : null;
}

export function serializeJob(job: CrawlJobRow, companyName: string | null = null) {
  const findings = findingsOf(job);
  let domain: string | null = findings?.domain ?? null;
  try {
    domain ??= registrableDomain(new URL(job.seedUrl).hostname);
  } catch {
    // Seed URLs are validated on creation; keep null for anything odd.
  }
  return {
    id: job.id,
    seedUrl: job.seedUrl,
    domain,
    status: job.status,
    maxPages: job.maxPages,
    pagesCrawled: job.pagesCrawled,
    companyId: job.companyId,
    companyName,
    error: job.error,
    summary: summaryOf(findings),
    createdById: job.createdById,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export type CrawlJobView = ReturnType<typeof serializeJob>;

/* -------------------------------------------------------------------------- */
/* Create / list / read                                                       */
/* -------------------------------------------------------------------------- */

export const createCrawlJobInput = z
  .object({
    url: z.string().trim().max(2000).optional(),
    companyId: z.string().trim().min(1).max(100).optional(),
    maxPages: z.number().int().min(1).max(MAX_PAGES).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.url) || Boolean(v.companyId), {
    message: "Give a website URL or pick a company.",
    path: ["url"],
  });

export type CreateCrawlJobInput = z.infer<typeof createCrawlJobInput>;

/** Validate a seed and refuse private / loopback literals up front (DNS is checked again at fetch time). */
export function validateSeed(raw: string): URL {
  const seed = seedUrlFrom(raw);
  if (!seed) throw invalid("url", "Enter an http or https website address.");
  const host = seed.hostname;
  if (!host.includes(".") && host !== "localhost" && !host.startsWith("[")) {
    throw invalid("url", "Enter a full domain, such as acme.com.");
  }
  if (hostBlocked(seed, env().CRAWLER_ALLOW_PRIVATE_HOSTS)) {
    throw invalid("url", "Private, loopback and internal addresses can't be crawled.");
  }
  return seed;
}

export async function createCrawlJob(actor: Actor, input: CreateCrawlJobInput, options: { audit?: boolean } = {}) {
  let company: CompanyRow | null = null;
  if (input.companyId) {
    company = await companyById(actor, input.companyId);
    if (!company) throw notFound("Company not found.");
  }
  const raw = input.url || company?.websiteUrl || company?.domain;
  if (!raw) throw invalid("companyId", "This company has no website or domain to crawl.");
  const seed = validateSeed(raw);

  const [job] = await db
    .insert(schema.crawlJob)
    .values({
      organizationId: actor.organizationId,
      companyId: company?.id ?? null,
      seedUrl: seed.toString(),
      maxPages: input.maxPages ?? 10,
      createdById: actor.userId,
    })
    .returning();
  if (!job) throw new Error("crawl job insert returned nothing");
  if (options.audit !== false) {
    await audit(actor, "crawl_job.create", "crawl_job", job.id, { seedUrl: job.seedUrl, companyId: job.companyId });
  }
  return serializeJob(job, company?.name ?? null);
}

export const listCrawlJobsQuery = z.object({
  status: z.enum(CRAWL_STATUSES).optional(),
  companyId: z.string().max(100).optional(),
});

export async function listCrawlJobs(actor: Actor, page: Page, filters: z.infer<typeof listCrawlJobsQuery> = {}) {
  const conditions: SQL[] = [eq(schema.crawlJob.organizationId, actor.organizationId)];
  if (filters.status) conditions.push(eq(schema.crawlJob.status, filters.status));
  if (filters.companyId) conditions.push(eq(schema.crawlJob.companyId, filters.companyId));
  const where = and(...conditions);
  const [rows, [totals]] = await Promise.all([
    db
      .select({ job: schema.crawlJob, companyName: schema.company.name })
      .from(schema.crawlJob)
      .leftJoin(schema.company, eq(schema.company.id, schema.crawlJob.companyId))
      .where(where)
      .orderBy(desc(schema.crawlJob.createdAt))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ total: count() }).from(schema.crawlJob).where(where),
  ]);
  return { jobs: rows.map((r) => serializeJob(r.job, r.companyName)), total: totals?.total ?? 0 };
}

export async function jobRow(actor: Actor, id: string) {
  const [row] = await db
    .select({ job: schema.crawlJob, companyName: schema.company.name })
    .from(schema.crawlJob)
    .leftJoin(schema.company, eq(schema.company.id, schema.crawlJob.companyId))
    .where(and(eq(schema.crawlJob.id, id), eq(schema.crawlJob.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("Crawl job not found.");
  return row;
}

export async function getCrawlJob(actor: Actor, id: string) {
  const { job, companyName } = await jobRow(actor, id);
  const pages = await db
    .select()
    .from(schema.crawlPage)
    .where(eq(schema.crawlPage.jobId, job.id))
    .orderBy(schema.crawlPage.fetchedAt);
  return {
    job: serializeJob(job, companyName),
    pages: pages.map((p) => ({
      id: p.id,
      url: p.url,
      statusCode: p.statusCode,
      title: p.title,
      skippedReason: p.skippedReason,
      fetchedAt: p.fetchedAt.toISOString(),
    })),
    findings: findingsOf(job),
  };
}

export type CrawlJobDetail = Awaited<ReturnType<typeof getCrawlJob>>;

/* -------------------------------------------------------------------------- */
/* Processing                                                                 */
/* -------------------------------------------------------------------------- */

const noRelease = async () => {
  // Nothing to release: no lock was taken.
};

async function acquireLock(jobId: string): Promise<{ held: boolean; release: () => Promise<void> }> {
  const client = redis();
  const key = `anhour:lock:crawl:${jobId}`;
  const token = randomUUID();
  if (!client) return { held: true, release: noRelease };
  try {
    const ok = await client.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (ok !== "OK") return { held: false, release: noRelease };
  } catch {
    // Redis down: the conditional status update below still prevents double processing.
    return { held: true, release: noRelease };
  }
  return {
    held: true,
    release: async () => {
      try {
        await client.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          token,
        );
      } catch {
        // The lock expires on its own.
      }
    },
  };
}

/** Pair found addresses with found people ("jane.doe@" ↔ Jane Doe) and infer the site's pattern. */
function linkEmailsAndPeople(findings: CrawlFindings): void {
  const samples: Array<{ firstName: string; lastName: string; email: string }> = [];
  for (const email of findings.emails) {
    const person = findings.people.find((p) => patternsFor(email.email, p.firstName, p.lastName).length > 0);
    if (!person) continue;
    email.person = person.name;
    person.email ??= email.email;
    samples.push({ firstName: person.firstName, lastName: person.lastName, email: email.email });
  }
  for (const person of findings.people) {
    if (person.email && !samples.some((s) => s.email === person.email)) {
      samples.push({ firstName: person.firstName, lastName: person.lastName, email: person.email });
    }
  }
  const detected = detectPattern(samples.filter((s) => s.email.endsWith(`@${findings.domain}`)));
  findings.emailPattern = detected
    ? { pattern: detected.pattern, confidence: detected.confidence, matches: detected.matches }
    : null;
}

/** Drop do-not-contact addresses, then verify what's left (cached, bounded). */
async function postProcess(organizationId: string, findings: CrawlFindings): Promise<void> {
  const suppressed = await suppressionChecker(organizationId, [
    findings.domain,
    ...findings.emails.map((e) => e.email),
    ...findings.people.flatMap((p) => (p.email ? [p.email] : [])),
  ]);
  const before = findings.emails.length;
  findings.emails = findings.emails.filter((e) => !suppressed(e.email));
  findings.suppressedEmails = before - findings.emails.length;
  for (const p of findings.people) if (p.email && suppressed(p.email)) p.email = null;

  linkEmailsAndPeople(findings);

  for (const email of findings.emails.slice(0, MAX_VERIFIED_EMAILS)) {
    try {
      const result = await verifyEmail(email.email, { organizationId });
      email.status = result.status;
      email.statusReason = result.reason;
    } catch (error) {
      log.warn("email verification failed during crawl", { component: "crawler", error });
    }
  }
}

/**
 * Run one crawl job. Safe to call from several places at once: a Redis lock per job plus a
 * conditional status update make sure only one worker crawls it. Re-runs stale "running" jobs.
 */
export async function processCrawlJob(jobId: string): Promise<"done" | "failed" | "skipped"> {
  const lock = await acquireLock(jobId);
  if (!lock.held) return "skipped";
  try {
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    const [job] = await db
      .update(schema.crawlJob)
      .set({ status: "running", startedAt: new Date(), finishedAt: null, error: null, pagesCrawled: 0 })
      .where(
        and(
          eq(schema.crawlJob.id, jobId),
          or(
            eq(schema.crawlJob.status, "queued"),
            and(eq(schema.crawlJob.status, "running"), lt(schema.crawlJob.startedAt, staleBefore)),
          ),
        ),
      )
      .returning();
    if (!job) return "skipped";
    await db.delete(schema.crawlPage).where(eq(schema.crawlPage.jobId, job.id));

    const started = Date.now();
    try {
      const { userAgent, allowPrivate } = {
        userAgent: env().CRAWLER_USER_AGENT,
        allowPrivate: env().CRAWLER_ALLOW_PRIVATE_HOSTS,
      };
      const outcome = await crawlSite({
        seedUrl: job.seedUrl,
        maxPages: job.maxPages,
        userAgent,
        allowPrivate,
        onPage: async (page: CrawlPageRecord) => {
          await db.insert(schema.crawlPage).values({ jobId: job.id, ...page });
          if (!page.skippedReason) {
            await db
              .update(schema.crawlJob)
              .set({ pagesCrawled: sql`${schema.crawlJob.pagesCrawled} + 1` })
              .where(eq(schema.crawlJob.id, job.id));
          }
        },
      });
      await postProcess(job.organizationId, outcome.findings);
      const fetchedOk = outcome.pages.some((p) => !p.skippedReason);
      const seedSkip = outcome.pages.find((p) => p.url === job.seedUrl && p.skippedReason)?.skippedReason;
      await db
        .update(schema.crawlJob)
        .set({
          status: fetchedOk ? "completed" : "failed",
          result: outcome.findings as unknown as Record<string, unknown>,
          error: fetchedOk ? null : failureMessage(seedSkip ?? outcome.pages[0]?.skippedReason ?? null),
          finishedAt: new Date(),
        })
        .where(eq(schema.crawlJob.id, job.id));
      log.info("crawl finished", {
        component: "crawler",
        jobId: job.id,
        organizationId: job.organizationId,
        fetched: outcome.fetched,
        recorded: outcome.pages.length,
        durationMs: Date.now() - started,
      });
      return fetchedOk ? "done" : "failed";
    } catch (error) {
      log.error("crawl failed", { component: "crawler", jobId: job.id, error });
      await db
        .update(schema.crawlJob)
        .set({ status: "failed", error: "The crawl stopped unexpectedly. Try again later.", finishedAt: new Date() })
        .where(eq(schema.crawlJob.id, job.id));
      return "failed";
    }
  } finally {
    await lock.release();
  }
}

function failureMessage(reason: string | null): string {
  switch (reason) {
    case "robots":
      return "The site's robots.txt doesn't allow crawling this page.";
    case "blocked_host":
      return "The address points to a private or internal network, which can't be crawled.";
    case "dns":
      return "The domain couldn't be found.";
    case "network":
      return "The site couldn't be reached.";
    case "timeout":
      return "The site didn't respond within 10 seconds.";
    case "not_html":
      return "The address isn't a web page.";
    case "too_large":
      return "The page is larger than 1 MB.";
    case "http_error":
      return "The site returned an error.";
    default:
      return "No pages could be fetched.";
  }
}

/** Queued jobs plus stale running ones, oldest first, for the background worker. */
export async function pendingCrawlJobIds(limit: number, minAgeMs = 20_000): Promise<string[]> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const queuedBefore = new Date(Date.now() - minAgeMs);
  const rows = await db
    .select({ id: schema.crawlJob.id })
    .from(schema.crawlJob)
    .where(
      or(
        and(eq(schema.crawlJob.status, "queued"), lt(schema.crawlJob.createdAt, queuedBefore)),
        and(eq(schema.crawlJob.status, "running"), lt(schema.crawlJob.startedAt, staleBefore)),
      ),
    )
    .orderBy(schema.crawlJob.createdAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/** A completed crawl of this domain (or company) from the last `maxAgeMs`, if any. */
export async function recentCompletedJob(actor: Actor, domain: string, companyId: string | null, maxAgeMs: number) {
  const since = new Date(Date.now() - maxAgeMs);
  const match: SQL[] = [
    sql`${schema.crawlJob.result}->>'domain' = ${registrableDomain(domain.split(":")[0] ?? domain)}`,
  ];
  if (companyId) match.push(eq(schema.crawlJob.companyId, companyId));
  const [row] = await db
    .select()
    .from(schema.crawlJob)
    .where(
      and(
        eq(schema.crawlJob.organizationId, actor.organizationId),
        eq(schema.crawlJob.status, "completed"),
        gt(schema.crawlJob.finishedAt, since),
        or(...match),
      ),
    )
    .orderBy(desc(schema.crawlJob.finishedAt))
    .limit(1);
  return row ?? null;
}

export async function crawlJobById(actor: Actor, id: string) {
  return (await jobRow(actor, id)).job;
}

/* -------------------------------------------------------------------------- */
/* Apply findings                                                             */
/* -------------------------------------------------------------------------- */

export const applyCrawlJobInput = z
  .object({
    companyId: z.string().trim().min(1).max(100).optional(),
    createContacts: z.boolean().default(false),
    /** Names of found people to create as contacts. All found people when omitted. */
    people: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .strict();

const COMPANY_FACT_FIELDS: Partial<Record<FactField, keyof CompanyRow>> = {
  description: "description",
  phone: "phone",
  linkedinUrl: "linkedinUrl",
  twitterUrl: "twitterUrl",
  foundedYear: "foundedYear",
  employeeCount: "employeeCount",
  city: "city",
  country: "country",
};
const NUMERIC_FIELDS = new Set<string>(["foundedYear", "employeeCount"]);

function bestFact(facts: Fact[], field: FactField): Fact | null {
  return facts.filter((f) => f.field === field).sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

/** Proposed company values from crawl findings, each with its source page and confidence. */
export function companyProposals(findings: CrawlFindings, company: CompanyRow): FieldProposal[] {
  const proposals: FieldProposal[] = [];
  for (const [factField, column] of Object.entries(COMPANY_FACT_FIELDS) as Array<[FactField, keyof CompanyRow]>) {
    const fact = bestFact(findings.facts, factField);
    if (!fact) continue;
    const value = NUMERIC_FIELDS.has(column) ? Number.parseInt(fact.value, 10) : fact.value.slice(0, 2000);
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    proposals.push({ field: column, value, source: "crawler", sourceUrl: fact.sourceUrl, confidence: fact.confidence });
  }
  if (!proposals.some((p) => p.field === "phone") && findings.phones[0]) {
    const phone = findings.phones[0];
    proposals.push({
      field: "phone",
      value: phone.value,
      source: "crawler",
      sourceUrl: phone.sourceUrl,
      confidence: phone.method === "text" ? 0.5 : 0.7,
    });
  }
  if (findings.technologies.length) {
    proposals.push({
      field: "technologies",
      value: findings.technologies.map((t) => t.name),
      source: "crawler",
      sourceUrl: findings.technologies[0]?.sourceUrl ?? findings.seedUrl,
      confidence: 0.8,
      merge: true,
    });
  }
  const origin = new URL(findings.seedUrl).origin;
  proposals.push({
    field: "websiteUrl",
    value: origin,
    source: "crawler",
    sourceUrl: findings.seedUrl,
    confidence: 0.9,
  });
  if (!company.domain) {
    proposals.push({
      field: "domain",
      value: findings.domain,
      source: "crawler",
      sourceUrl: findings.seedUrl,
      confidence: 0.9,
    });
  }
  if (findings.emailPattern) {
    proposals.push({
      field: "emailPattern",
      value: findings.emailPattern.pattern,
      source: "crawler",
      sourceUrl: findings.seedUrl,
      confidence: Math.min(0.8, findings.emailPattern.confidence),
    });
  }
  return proposals;
}

/** Write findings to a company: provenance for every value, never downgrading confidence. */
export async function applyFindingsToCompany(actor: Actor, company: CompanyRow, findings: CrawlFindings) {
  const proposals = companyProposals(findings, company);
  const plan = await planFieldUpdates(
    actor.organizationId,
    "company",
    company.id,
    company as unknown as Record<string, unknown>,
    proposals,
  );
  if (typeof plan.updates.domain === "string") {
    const clash = await companyByDomain(actor, plan.updates.domain);
    if (clash && clash.id !== company.id) delete plan.updates.domain;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.company)
      .set({ ...(plan.updates as Partial<CompanyRow>), lastEnrichedAt: new Date() })
      .where(and(eq(schema.company.id, company.id), eq(schema.company.organizationId, actor.organizationId)));
    if (plan.provenance.length) await tx.insert(schema.fieldProvenance).values(plan.provenance);
  });
  return plan.outcomes;
}

function companyNameFrom(findings: CrawlFindings): string {
  const pick = bestFact(findings.facts, "siteName") ?? bestFact(findings.facts, "name");
  if (pick) return pick.value.slice(0, 120);
  const title = bestFact(findings.facts, "title")
    ?.value.split(/\s[|–—-]\s/)[0]
    ?.trim();
  return (title || findings.domain).slice(0, 120);
}

interface ContactOutcome {
  name: string;
  contactId: string | null;
  status: "created" | "duplicate" | "suppressed" | "skipped";
}

async function createContactsFromPeople(
  actor: Actor,
  company: CompanyRow,
  findings: CrawlFindings,
  names: string[] | undefined,
): Promise<ContactOutcome[]> {
  requirePermission(actor, "contact:create");
  const wanted = names ? new Set(names.map((n) => n.toLowerCase())) : null;
  const people = findings.people.filter((p) => !wanted || wanted.has(p.name.toLowerCase()));
  const domain = company.domain ?? findings.domain;
  const suppressed = await suppressionChecker(actor.organizationId, [
    domain,
    ...people.flatMap((p) => (p.email ? [p.email] : [])),
  ]);
  if (suppressed(domain)) return people.map((p) => ({ name: p.name, contactId: null, status: "suppressed" }));

  const outcomes: ContactOutcome[] = [];
  for (const person of people) {
    if (person.email && suppressed(person.email)) {
      outcomes.push({ name: person.name, contactId: null, status: "suppressed" });
      continue;
    }
    const duplicate = await findDuplicateContact(actor, company.id, person);
    if (duplicate) {
      outcomes.push({ name: person.name, contactId: duplicate, status: "duplicate" });
      continue;
    }
    const found = person.email ? findings.emails.find((e) => e.email === person.email) : null;
    const emailStatus: EmailStatus =
      found?.status && (EMAIL_STATUSES as readonly string[]).includes(found.status)
        ? (found.status as EmailStatus)
        : "unverified";
    if (emailStatus === "invalid") person.email = null;
    const [row] = await db
      .insert(schema.contact)
      .values({
        organizationId: actor.organizationId,
        companyId: company.id,
        firstName: person.firstName,
        lastName: person.lastName,
        title: person.title,
        email: person.email,
        emailStatus: person.email ? emailStatus : "unverified",
        emailVerifiedAt: person.email && found?.status ? new Date() : null,
        linkedinUrl: person.linkedinUrl,
        source: "crawler",
        ownerId: actor.userId,
        lastEnrichedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.contact.id });
    if (!row) {
      outcomes.push({ name: person.name, contactId: null, status: "duplicate" });
      continue;
    }
    const prov = (field: string, value: string | null) =>
      value
        ? [
            {
              organizationId: actor.organizationId,
              entityType: "contact" as const,
              entityId: row.id,
              field,
              value,
              source: "crawler",
              sourceUrl: person.sourceUrl,
              confidence: person.confidence,
            },
          ]
        : [];
    const rows = [
      ...prov("firstName", person.firstName),
      ...prov("lastName", person.lastName),
      ...prov("title", person.title),
      ...prov("email", person.email),
      ...prov("linkedinUrl", person.linkedinUrl),
    ];
    if (rows.length) await db.insert(schema.fieldProvenance).values(rows);
    outcomes.push({ name: person.name, contactId: row.id, status: "created" });
  }
  return outcomes;
}

async function findDuplicateContact(actor: Actor, companyId: string, person: FoundPerson): Promise<string | null> {
  const byName = and(
    eq(schema.contact.companyId, companyId),
    sql`lower(${schema.contact.firstName}) = ${person.firstName.toLowerCase()}`,
    sql`lower(${schema.contact.lastName}) = ${person.lastName.toLowerCase()}`,
  );
  const [row] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, actor.organizationId),
        person.email ? or(byName, sql`lower(${schema.contact.email}) = ${person.email}`) : byName,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function applyCrawlJob(actor: Actor, jobId: string, input: z.infer<typeof applyCrawlJobInput>) {
  const { job } = await jobRow(actor, jobId);
  const findings = findingsOf(job);
  if (job.status !== "completed" || !findings) throw conflict("This crawl hasn't finished yet.");

  let company: CompanyRow | null = null;
  const targetId = input.companyId ?? job.companyId;
  if (targetId) {
    company = await companyById(actor, targetId);
    if (!company) throw notFound("Company not found.");
  } else {
    company = await companyByDomain(actor, findings.domain);
  }
  let createdCompany = false;
  if (!company) {
    requirePermission(actor, "company:create");
    const [row] = await db
      .insert(schema.company)
      .values({
        organizationId: actor.organizationId,
        name: companyNameFrom(findings),
        domain: findings.domain,
        websiteUrl: new URL(findings.seedUrl).origin,
        source: "crawler",
        ownerId: actor.userId,
      })
      .onConflictDoNothing()
      .returning();
    company = row ?? (await companyByDomain(actor, findings.domain));
    if (!company) throw conflict("A company with this domain already exists.");
    createdCompany = Boolean(row);
    if (row) {
      await db.insert(schema.fieldProvenance).values({
        organizationId: actor.organizationId,
        entityType: "company",
        entityId: row.id,
        field: "name",
        value: row.name,
        source: "crawler",
        sourceUrl: findings.seedUrl,
        confidence: 0.7,
      });
    }
  }

  const fields: FieldOutcome[] = await applyFindingsToCompany(actor, company, findings);
  if (job.companyId !== company.id) {
    await db.update(schema.crawlJob).set({ companyId: company.id }).where(eq(schema.crawlJob.id, job.id));
  }

  const contacts = input.createContacts ? await createContactsFromPeople(actor, company, findings, input.people) : [];

  await audit(actor, "crawl_job.apply", "company", company.id, {
    crawlJobId: job.id,
    fieldsSet: fields.filter((f) => f.action === "set").map((f) => f.field),
    contactsCreated: contacts.filter((c) => c.status === "created").length,
    createdCompany,
  });

  return {
    company: { id: company.id, name: company.name, createdNow: createdCompany },
    fields,
    contacts,
  };
}
