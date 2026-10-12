import "server-only";

import { and, count, desc, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { can, isRole, type Role } from "@/lib/rbac/permissions";
import { type Actor, requirePermission } from "@/server/auth/actor";
import type { CrawlFindings } from "@/server/crawler/types";
import { domainFromInput } from "@/server/crawler/url";
import { db, schema } from "@/server/db";
import { type EmailPattern, generateCandidates, isEmailPattern, patternsFor } from "@/server/email/patterns";
import { smtpProbeEnabled, type VerificationResult, verifyEmail } from "@/server/email/verify";
import { checkSyntax } from "@/server/email/verify-rules";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";
import { log } from "@/server/log";
import { redis } from "@/server/redis";

import { audit } from "./audit";
import { enrichOrganization, fillContactFromProviders, matchPerson } from "./enrichment";
import { companyByDomain, companyByName, type Lookup, suppressionChecker } from "./enrichment-common";
import { recordEvent } from "./events";
import { headerKey, parseCsv, toCsv } from "./records";
import {
  crawlJobById,
  createCrawlJob,
  findingsOf,
  processCrawlJob,
  recentCompletedJob,
  validateSeed,
} from "./research";
import { recordLookups } from "./usage-events";
import { randomUUID } from "node:crypto";

/**
 * Bulk enrichment jobs (Data enrichment screen): CSV uploads, selected records and lists. Jobs are
 * queued, then processed in the background (right after the request via `after()`, and by the
 * `enrichment` scheduled job for anything left over). Automation schedules are stored as an
 * enrichment_job row of kind "records" with `options.automation = true`; the scheduled job spawns a
 * fresh records job from it when it is due.
 */

export const CSV_MAX_ROWS = 10_000;
export const RECORDS_MAX_IDS = 5_000;
const RESULT_PAGE = 500;
const STALE_AFTER_MS = 30 * 60 * 1000;
const LOCK_TTL_MS = 25 * 60 * 1000;
const REUSE_CRAWL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_VERIFICATION_DAYS = 90;

type JobRow = typeof schema.enrichmentJob.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

const invalid = (path: string, message: string) => new HttpError(422, "Some fields are invalid.", [{ path, message }]);

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface CsvInputRow {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  domain: string | null;
  website: string | null;
  email: string | null;
}

export type CsvRowSource = "crawler" | "pattern" | "input" | "records";

export interface CsvResultRow {
  row: number;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  domain: string | null;
  inputEmail: string | null;
  email: string | null;
  status: string | null;
  source: CsvRowSource | null;
  confidence: number | null;
  sourceUrl: string | null;
  note: string | null;
  saved: "created" | "exists" | null;
}

export interface RecordOutcome {
  entityType: "contact" | "company";
  id: string;
  name: string;
  action: "verified" | "found_email" | "no_email_found" | "enriched" | "skipped" | "failed";
  detail: string;
}

export interface EnrichmentJobView {
  id: string;
  kind: JobRow["kind"];
  status: JobRow["status"];
  fileName: string | null;
  total: number;
  processed: number;
  enriched: number;
  failed: number;
  saveToRecords: boolean;
  automated: boolean;
  label: string;
  error: string | null;
  createdById: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function optionsOf(job: Pick<JobRow, "options">): Record<string, unknown> {
  return job.options ?? {};
}

function labelOf(job: JobRow): string {
  const o = optionsOf(job);
  if (job.kind === "csv") return job.fileName ?? "CSV upload";
  if (job.kind === "list") return typeof o.listName === "string" ? `List: ${o.listName}` : "List";
  if (typeof o.segmentLabel === "string") return o.segmentLabel;
  if (o.automationId) return "Scheduled re-verification";
  return "Selected records";
}

export function jobView(job: JobRow): EnrichmentJobView {
  const o = optionsOf(job);
  const r = job.result ?? {};
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    fileName: job.fileName,
    total: job.total,
    processed: job.processed,
    enriched: job.enriched,
    failed: job.failed,
    saveToRecords: o.saveToRecords === true,
    automated: Boolean(o.automationId),
    label: labelOf(job),
    error: typeof r.error === "string" ? r.error : null,
    createdById: job.createdById,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/** Rows that are real jobs (automation settings live in the same table). */
const notAutomationConfig = sql`coalesce(${schema.enrichmentJob.options}->>'automation', 'false') <> 'true'`;

/* -------------------------------------------------------------------------- */
/* CSV parsing                                                                */
/* -------------------------------------------------------------------------- */

const COLUMN_KEYS: Record<keyof CsvInputRow | "name", string[]> = {
  firstName: ["firstname", "first", "givenname"],
  lastName: ["lastname", "last", "surname", "familyname"],
  name: ["name", "fullname", "person", "contactname"],
  company: ["company", "companyname", "organization", "organisation", "organizationname", "account"],
  domain: ["domain", "companydomain", "emaildomain"],
  website: ["website", "url", "companywebsite", "websiteurl", "site"],
  email: ["email", "emailaddress", "workemail", "mail"],
};

function splitName(name: string): { first: string | null; last: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0] ?? null, last: parts.length > 1 ? (parts[parts.length - 1] ?? null) : null };
}

/** Parse an uploaded CSV of people. Throws 422 when no known column is present or there are too many rows. */
export function parsePeopleCsv(csv: string): CsvInputRow[] {
  const table = parseCsv(csv);
  const header = table[0];
  if (!header) throw invalid("csv", "The file is empty.");
  const keys = header.map(headerKey);
  const index = (field: keyof typeof COLUMN_KEYS) => keys.findIndex((k) => COLUMN_KEYS[field].includes(k));
  const at = {
    firstName: index("firstName"),
    lastName: index("lastName"),
    name: index("name"),
    company: index("company"),
    domain: index("domain"),
    website: index("website"),
    email: index("email"),
  };
  if (Object.values(at).every((i) => i < 0)) {
    throw invalid("csv", "No known columns found. Use first_name, last_name, name, company, domain, website or email.");
  }
  const body = table.slice(1);
  if (!body.length) throw invalid("csv", "The file has a header but no rows.");
  if (body.length > CSV_MAX_ROWS) {
    throw invalid("csv", `The file has ${body.length.toLocaleString("en-US")} rows. Enrich up to 10,000 at a time.`);
  }
  const cell = (row: string[], i: number) => (i >= 0 ? row[i]?.trim().slice(0, 300) || null : null);
  return body.map((row) => {
    let firstName = cell(row, at.firstName);
    let lastName = cell(row, at.lastName);
    const full = cell(row, at.name);
    if (full && !firstName && !lastName) {
      const split = splitName(full);
      firstName = split.first;
      lastName = split.last;
    }
    return {
      firstName,
      lastName,
      company: cell(row, at.company),
      domain: cell(row, at.domain),
      website: cell(row, at.website),
      email: cell(row, at.email)?.toLowerCase() ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

const idList = z.array(z.string().trim().min(1).max(128)).max(RECORDS_MAX_IDS);

export const SEGMENTS = [
  "missing_email",
  "unverified_email",
  "stale_verification",
  "company_missing_firmographics",
  "contact_without_company",
] as const;
export type Segment = (typeof SEGMENTS)[number];

export const createJobInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("csv"),
      fileName: z.string().trim().max(200).optional(),
      csv: z.string().min(1, "Upload a CSV file."),
      saveToRecords: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("records"),
      contactIds: idList.optional(),
      companyIds: idList.optional(),
      segment: z.enum(SEGMENTS).optional(),
    })
    .strict()
    .refine((v) => Boolean(v.segment) || (v.contactIds?.length ?? 0) + (v.companyIds?.length ?? 0) > 0, {
      message: "Pick records to enrich.",
      path: ["contactIds"],
    }),
  z.object({ kind: z.literal("list"), listId: z.string().trim().min(1).max(128) }).strict(),
]);
export type CreateJobInput = z.infer<typeof createJobInput>;

const SEGMENT_LABELS: Record<Segment, string> = {
  missing_email: "Contacts missing an email",
  unverified_email: "Unverified or unknown emails",
  stale_verification: "Verification older than 90 days",
  company_missing_firmographics: "Companies missing industry, size or description",
  contact_without_company: "Contacts without a company",
};

/** Ids in a health segment (scoped to the workspace), capped. */
export async function segmentIds(
  organizationId: string,
  segment: Segment,
  limit = RECORDS_MAX_IDS,
): Promise<{ contactIds: string[]; companyIds: string[] }> {
  const c = schema.contact;
  const staleBefore = new Date(Date.now() - STALE_VERIFICATION_DAYS * DAY_MS);
  if (segment === "company_missing_firmographics") {
    const rows = await db
      .select({ id: schema.company.id })
      .from(schema.company)
      .where(
        and(
          eq(schema.company.organizationId, organizationId),
          or(isNull(schema.company.industry), isNull(schema.company.employeeCount), isNull(schema.company.description)),
        ),
      )
      .limit(limit);
    return { contactIds: [], companyIds: rows.map((r) => r.id) };
  }
  const where: Record<Exclude<Segment, "company_missing_firmographics">, SQL | undefined> = {
    missing_email: isNull(c.email),
    unverified_email: and(sql`${c.email} is not null`, inArray(c.emailStatus, ["unverified", "unknown"])),
    stale_verification: and(sql`${c.email} is not null`, lt(c.emailVerifiedAt, staleBefore)),
    contact_without_company: isNull(c.companyId),
  };
  const rows = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.organizationId, organizationId), where[segment]))
    .limit(limit);
  return { contactIds: rows.map((r) => r.id), companyIds: [] };
}

async function scopedIds(organizationId: string, contactIds: string[], companyIds: string[]) {
  const [contacts, companies] = await Promise.all([
    contactIds.length
      ? db
          .select({ id: schema.contact.id })
          .from(schema.contact)
          .where(and(eq(schema.contact.organizationId, organizationId), inArray(schema.contact.id, contactIds)))
      : Promise.resolve([]),
    companyIds.length
      ? db
          .select({ id: schema.company.id })
          .from(schema.company)
          .where(and(eq(schema.company.organizationId, organizationId), inArray(schema.company.id, companyIds)))
      : Promise.resolve([]),
  ]);
  return { contactIds: contacts.map((r) => r.id), companyIds: companies.map((r) => r.id) };
}

export async function createEnrichmentJob(actor: Actor, input: CreateJobInput): Promise<EnrichmentJobView> {
  let values: typeof schema.enrichmentJob.$inferInsert;
  if (input.kind === "csv") {
    if (input.saveToRecords) requirePermission(actor, "contact:create");
    const rows = parsePeopleCsv(input.csv);
    values = {
      organizationId: actor.organizationId,
      kind: "csv",
      fileName: input.fileName || "upload.csv",
      total: rows.length,
      options: { rows, saveToRecords: input.saveToRecords === true },
      createdById: actor.userId,
    };
  } else if (input.kind === "list") {
    const [list] = await db
      .select()
      .from(schema.list)
      .where(and(eq(schema.list.id, input.listId), eq(schema.list.organizationId, actor.organizationId)))
      .limit(1);
    if (!list) throw notFound("List not found.");
    const members = await db
      .select({ id: schema.listMember.entityId })
      .from(schema.listMember)
      .where(eq(schema.listMember.listId, list.id))
      .limit(RECORDS_MAX_IDS);
    const ids = members.map((m) => m.id);
    const scoped = await scopedIds(
      actor.organizationId,
      list.entityType === "contact" ? ids : [],
      list.entityType === "company" ? ids : [],
    );
    values = {
      organizationId: actor.organizationId,
      kind: "list",
      total: scoped.contactIds.length + scoped.companyIds.length,
      options: { ...scoped, listId: list.id, listName: list.name },
      createdById: actor.userId,
    };
  } else {
    let ids: { contactIds: string[]; companyIds: string[] };
    if (input.segment) ids = await segmentIds(actor.organizationId, input.segment);
    else ids = await scopedIds(actor.organizationId, input.contactIds ?? [], input.companyIds ?? []);
    if (!input.segment && ids.contactIds.length + ids.companyIds.length === 0) throw notFound("Records not found.");
    values = {
      organizationId: actor.organizationId,
      kind: "records",
      total: ids.contactIds.length + ids.companyIds.length,
      options: {
        ...ids,
        ...(input.segment ? { segment: input.segment, segmentLabel: SEGMENT_LABELS[input.segment] } : {}),
      },
      createdById: actor.userId,
    };
  }
  const [job] = await db.insert(schema.enrichmentJob).values(values).returning();
  if (!job) throw new Error("enrichment job insert returned nothing");
  await audit(actor, "enrichment_job.create", "enrichment_job", job.id, { kind: job.kind, total: job.total });
  return jobView(job);
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export const listJobsQuery = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
  kind: z.enum(["csv", "list", "records"]).optional(),
});

export async function listEnrichmentJobs(actor: Actor, page: Page, filters: z.infer<typeof listJobsQuery> = {}) {
  const where = and(
    eq(schema.enrichmentJob.organizationId, actor.organizationId),
    notAutomationConfig,
    filters.status ? eq(schema.enrichmentJob.status, filters.status) : undefined,
    filters.kind ? eq(schema.enrichmentJob.kind, filters.kind) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(schema.enrichmentJob)
      .where(where)
      .orderBy(desc(schema.enrichmentJob.createdAt))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: count() }).from(schema.enrichmentJob).where(where),
  ]);
  return { jobs: rows.map(jobView), total: total?.n ?? 0 };
}

async function jobRow(actor: Pick<Actor, "organizationId">, id: string): Promise<JobRow> {
  const [row] = await db
    .select()
    .from(schema.enrichmentJob)
    .where(
      and(
        eq(schema.enrichmentJob.id, id),
        eq(schema.enrichmentJob.organizationId, actor.organizationId),
        notAutomationConfig,
      ),
    )
    .limit(1);
  if (!row) throw notFound("Enrichment job not found.");
  return row;
}

function csvRowsOf(job: JobRow): CsvResultRow[] {
  const rows = job.result?.rows;
  return Array.isArray(rows) ? (rows as CsvResultRow[]) : [];
}

function outcomesOf(job: JobRow): RecordOutcome[] {
  const rows = job.result?.outcomes;
  return Array.isArray(rows) ? (rows as RecordOutcome[]) : [];
}

export async function getEnrichmentJob(actor: Actor, id: string, rowsPage = 1) {
  const job = await jobRow(actor, id);
  const rows = csvRowsOf(job);
  const start = (Math.max(1, rowsPage) - 1) * RESULT_PAGE;
  return {
    job: jobView(job),
    rows: rows.slice(start, start + RESULT_PAGE),
    rowsTotal: rows.length,
    rowsPerPage: RESULT_PAGE,
    outcomes: outcomesOf(job).slice(0, RESULT_PAGE),
  };
}

const CSV_HEADER = [
  "row",
  "first_name",
  "last_name",
  "company",
  "domain",
  "input_email",
  "email",
  "email_status",
  "source",
  "confidence",
  "source_url",
  "note",
  "saved",
];

export async function enrichmentJobCsv(actor: Actor, id: string): Promise<{ filename: string; csv: string }> {
  const job = await jobRow(actor, id);
  const base = (job.fileName ?? `enrichment-${job.id.slice(0, 8)}`).replace(/\.csv$/i, "").replace(/[^\w.-]+/g, "-");
  if (job.kind === "csv") {
    const csv = toCsv(
      CSV_HEADER,
      csvRowsOf(job).map((r) => [
        r.row,
        r.firstName,
        r.lastName,
        r.company,
        r.domain,
        r.inputEmail,
        r.email,
        r.status,
        r.source,
        r.confidence,
        r.sourceUrl,
        r.note,
        r.saved,
      ]),
    );
    return { filename: `${base}-enriched.csv`, csv };
  }
  const csv = toCsv(
    ["type", "id", "name", "action", "detail"],
    outcomesOf(job).map((o) => [o.entityType, o.id, o.name, o.action, o.detail]),
  );
  return { filename: `${base}-results.csv`, csv };
}

/* -------------------------------------------------------------------------- */
/* Processing                                                                 */
/* -------------------------------------------------------------------------- */

const noRelease = async () => {
  // Nothing to release.
};

async function acquireLock(jobId: string): Promise<{ held: boolean; release: () => Promise<void> }> {
  const client = redis();
  if (!client) return { held: true, release: noRelease };
  const key = `anhour:lock:enrichment:${jobId}`;
  const token = randomUUID();
  try {
    const ok = await client.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (ok !== "OK") return { held: false, release: noRelease };
  } catch {
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
        // Expires on its own.
      }
    },
  };
}

/** The member who created the job, acting with their current role (member when they left). */
async function jobActor(job: JobRow): Promise<Actor> {
  let role: Role = "member";
  if (job.createdById) {
    const [m] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.userId, job.createdById), eq(schema.member.organizationId, job.organizationId)))
      .limit(1);
    if (m && isRole(m.role)) role = m.role;
  }
  // A viewer can't create jobs, but a creator may have been demoted since: never act above member then.
  if (!can(role, "enrich:run")) role = "member";
  return {
    kind: "user",
    userId: job.createdById,
    apiKeyId: null,
    organizationId: job.organizationId,
    role,
    isPlatformAdmin: false,
    tenant: { kind: "primary", host: "scheduler" },
  };
}

async function progress(jobId: string, values: Partial<typeof schema.enrichmentJob.$inferInsert>) {
  await db.update(schema.enrichmentJob).set(values).where(eq(schema.enrichmentJob.id, jobId));
}

/**
 * Process one queued job. Safe to call concurrently: a Redis lock plus a conditional claim make sure
 * only one worker runs it; a "running" job left behind by a restart is picked up again.
 */
export async function processEnrichmentJob(jobId: string): Promise<"done" | "failed" | "skipped"> {
  const lock = await acquireLock(jobId);
  if (!lock.held) return "skipped";
  try {
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    const [job] = await db
      .update(schema.enrichmentJob)
      .set({ status: "running", processed: 0, enriched: 0, failed: 0, finishedAt: null })
      .where(
        and(
          eq(schema.enrichmentJob.id, jobId),
          notAutomationConfig,
          or(
            eq(schema.enrichmentJob.status, "queued"),
            and(eq(schema.enrichmentJob.status, "running"), lt(schema.enrichmentJob.createdAt, staleBefore)),
          ),
        ),
      )
      .returning();
    if (!job) return "skipped";
    const actor = await jobActor(job);
    try {
      if (job.kind === "csv") await runCsvJob(actor, job);
      else await runRecordsJob(actor, job);
      return "done";
    } catch (error) {
      log.error("enrichment job failed", { component: "enrichment", jobId, error });
      await progress(jobId, {
        status: "failed",
        finishedAt: new Date(),
        result: { ...(job.result ?? {}), error: "The job stopped unexpectedly. Try again later." },
      });
      return "failed";
    }
  } finally {
    await lock.release();
  }
}

/** Queued jobs plus stale running ones, oldest first. */
export async function pendingEnrichmentJobIds(limit: number, minAgeMs = 20_000): Promise<string[]> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const queuedBefore = new Date(Date.now() - minAgeMs);
  const rows = await db
    .select({ id: schema.enrichmentJob.id })
    .from(schema.enrichmentJob)
    .where(
      and(
        notAutomationConfig,
        or(
          and(eq(schema.enrichmentJob.status, "queued"), lt(schema.enrichmentJob.createdAt, queuedBefore)),
          and(eq(schema.enrichmentJob.status, "running"), lt(schema.enrichmentJob.createdAt, staleBefore)),
        ),
      ),
    )
    .orderBy(schema.enrichmentJob.createdAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/* ------------------------------ CSV rows ---------------------------------- */

interface DomainResearch {
  findings: CrawlFindings | null;
  companyPattern: EmailPattern | null;
}

function isHostnameDomain(domain: string): boolean {
  const host = domain.split(":")[0] ?? "";
  return /[a-z]/i.test(host.split(".").pop() ?? "") && host.includes(".");
}

function confidenceOf(verification: VerificationResult | null, base: number): number {
  const v = verification?.status;
  if (v === "valid") return Math.max(base, 0.95);
  return Math.round(base * 100) / 100;
}

async function researchDomain(
  actor: Actor,
  domain: string,
  website: string | null,
  cache: Map<string, Promise<DomainResearch>>,
  lookups: Lookup[],
): Promise<DomainResearch> {
  const key = domain.toLowerCase();
  const pending = cache.get(key);
  if (pending !== undefined) return pending;
  const work = (async (): Promise<DomainResearch> => {
    const company = await companyByDomain(actor, domain.split(":")[0] ?? domain);
    const companyPattern = company?.emailPattern && isEmailPattern(company.emailPattern) ? company.emailPattern : null;
    let findings: CrawlFindings | null = null;
    try {
      let job: typeof schema.crawlJob.$inferSelect | null = await recentCompletedJob(
        actor,
        domain,
        company?.id ?? null,
        REUSE_CRAWL_MS,
      );
      // Only reuse a crawl that started at the site's home page: one seeded deep inside the site may
      // have missed the team page.
      if (job && new URL(job.seedUrl).pathname !== "/") job = null;
      const cached = Boolean(job);
      if (!job && can(actor.role, "crawler:run")) {
        const seed = new URL("/", validateSeed(website ?? domain));
        const created = await createCrawlJob(
          actor,
          { url: seed.toString(), companyId: company?.id, maxPages: 5 },
          { audit: false },
        );
        await processCrawlJob(created.id);
        job = await crawlJobById(actor, created.id);
      }
      if (job) {
        lookups.push({ type: "website_crawl", target: domain, cached, cost: 0 });
        findings = job.status === "completed" ? findingsOf(job) : null;
      }
    } catch (error) {
      if (!(error instanceof HttpError)) log.warn("csv enrichment crawl failed", { component: "enrichment", error });
    }
    return { findings, companyPattern };
  })();
  cache.set(key, work);
  return work;
}

function nameMatches(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** The person's address on the crawled site: listed with them, or a found address in their name's format. */
function emailFromFindings(findings: CrawlFindings, first: string, last: string) {
  const person = findings.people.find((p) => nameMatches(p.firstName, first) && nameMatches(p.lastName, last));
  if (person?.email) {
    const found = findings.emails.find((e) => e.email === person.email);
    return {
      email: person.email,
      sourceUrl: found?.sourceUrl ?? person.sourceUrl,
      confidence: Math.min(0.9, Math.max(0.7, person.confidence)),
      status: found?.status ?? null,
    };
  }
  const byFormat = findings.emails.find((e) => patternsFor(e.email, first, last).length > 0);
  if (byFormat) {
    return { email: byFormat.email, sourceUrl: byFormat.sourceUrl, confidence: 0.8, status: byFormat.status ?? null };
  }
  return null;
}

async function enrichCsvRow(
  actor: Actor,
  input: CsvInputRow,
  index: number,
  cache: Map<string, Promise<DomainResearch>>,
  lookups: Lookup[],
): Promise<CsvResultRow> {
  const out: CsvResultRow = {
    row: index + 1,
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    domain: input.domain ?? (input.website ? domainFromInput(input.website) : null),
    inputEmail: input.email,
    email: null,
    status: null,
    source: null,
    confidence: null,
    sourceUrl: null,
    note: null,
    saved: null,
  };

  const verify = async (email: string) => {
    const result = await verifyEmail(email, { organizationId: actor.organizationId });
    lookups.push({ type: "email_verification", target: email, cached: result.cached, cost: 0 });
    return result;
  };

  if (input.email) {
    const suppressed = await suppressionChecker(actor.organizationId, [input.email]);
    if (!checkSyntax(input.email).ok) {
      return { ...out, status: "invalid", note: "This isn't a valid email address." };
    }
    if (suppressed(input.email)) return { ...out, note: "On the do-not-contact list. Not checked." };
    const result = await verify(input.email);
    return { ...out, email: result.email, status: result.status, source: "input", confidence: 1 };
  }

  const first = input.firstName;
  const last = input.lastName;
  let domain = out.domain ? domainFromInput(out.domain) : null;
  if (!domain && input.company) {
    const company = await companyByName(actor, input.company);
    if (company?.domain) domain = domainFromInput(company.domain);
  }
  if (!first || !last || !domain) {
    return { ...out, note: "Add an email, or a first and last name with a company domain or website." };
  }
  out.domain = domain;
  const suppressed = await suppressionChecker(actor.organizationId, [domain]);
  if (suppressed(domain)) return { ...out, note: "The domain is on the do-not-contact list. Not checked." };

  const research = await researchDomain(actor, domain, input.website, cache, lookups);
  const fromSite = research.findings ? emailFromFindings(research.findings, first, last) : null;
  if (fromSite) {
    const check = await suppressionChecker(actor.organizationId, [fromSite.email]);
    if (!check(fromSite.email)) {
      const status = fromSite.status ?? (await verify(fromSite.email)).status;
      return {
        ...out,
        email: fromSite.email,
        status,
        source: "crawler",
        confidence: confidenceOf(null, fromSite.confidence),
        sourceUrl: fromSite.sourceUrl,
      };
    }
  }

  const mailDomain = domain.split(":")[0] ?? domain;
  if (!isHostnameDomain(mailDomain)) {
    return { ...out, note: "No address found on the website, and the domain can't receive mail." };
  }
  const sitePattern =
    research.findings?.emailPattern && research.findings.domain === mailDomain
      ? research.findings.emailPattern.pattern
      : null;
  const pattern = research.companyPattern ?? (sitePattern && isEmailPattern(sitePattern) ? sitePattern : null);
  const candidates = generateCandidates(first, last, mailDomain, pattern);
  const toCheck = candidates.slice(0, smtpProbeEnabled() ? 3 : 1);
  let best: VerificationResult | null = null;
  for (const candidate of toCheck) {
    const result = await verify(candidate);
    if (result.status === "valid") {
      best = result;
      break;
    }
    if (result.status === "invalid" && (result.reason === "no_mail_host" || result.reason === "null_mx")) {
      best = result;
      break;
    }
    best ??= result;
  }
  if (!best || best.status === "invalid") {
    return { ...out, status: best?.status ?? null, note: "No deliverable address found." };
  }
  return {
    ...out,
    email: best.email,
    status: best.status,
    source: "pattern",
    confidence: confidenceOf(best, pattern ? 0.6 : 0.3),
    note: pattern ? "Generated from the company's email format." : "A best guess from common formats.",
  };
}

/** Save a found person as a contact, with provenance for every value written. */
async function saveRow(actor: Actor, row: CsvResultRow): Promise<CsvResultRow["saved"]> {
  if (!row.email || row.status === "invalid" || row.status === "disposable") return null;
  const [existing] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(eq(schema.contact.organizationId, actor.organizationId), sql`lower(${schema.contact.email}) = ${row.email}`),
    )
    .limit(1);
  if (existing) return "exists";
  const company = row.domain ? await companyByDomain(actor, row.domain.split(":")[0] ?? row.domain) : null;
  const now = new Date();
  const [created] = await db
    .insert(schema.contact)
    .values({
      organizationId: actor.organizationId,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      emailStatus: (row.status ?? "unverified") as ContactRow["emailStatus"],
      emailVerifiedAt: row.status ? now : null,
      companyId: company?.id ?? null,
      ownerId: actor.userId,
      source: "csv_enrichment",
      lastEnrichedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.contact.id });
  if (!created) return "exists";
  const base = { organizationId: actor.organizationId, entityType: "contact" as const, entityId: created.id };
  await db.insert(schema.fieldProvenance).values([
    ...(row.firstName
      ? [
          {
            ...base,
            field: "firstName",
            value: row.firstName,
            source: "csv_enrichment",
            confidence: 1,
            retrievedAt: now,
          },
        ]
      : []),
    ...(row.lastName
      ? [{ ...base, field: "lastName", value: row.lastName, source: "csv_enrichment", confidence: 1, retrievedAt: now }]
      : []),
    {
      ...base,
      field: "email",
      value: row.email,
      source: row.source ?? "csv_enrichment",
      sourceUrl: row.sourceUrl,
      confidence: row.confidence ?? 0.3,
      retrievedAt: now,
    },
    ...(row.status
      ? [
          {
            ...base,
            field: "emailStatus",
            value: row.status,
            source: "verification",
            confidence: row.status === "unknown" ? 0.5 : 0.9,
            retrievedAt: now,
          },
        ]
      : []),
  ]);
  await audit(actor, "contact.create", "contact", created.id, { source: "csv_enrichment" });
  await recordEvent({
    organizationId: actor.organizationId,
    type: "contact_created",
    summary: "Added from CSV enrichment",
    contactId: created.id,
    companyId: company?.id ?? null,
    actorUserId: actor.userId,
  });
  return "created";
}

async function runCsvJob(actor: Actor, job: JobRow): Promise<void> {
  const options = optionsOf(job);
  const rows = (Array.isArray(options.rows) ? options.rows : []) as CsvInputRow[];
  const save = options.saveToRecords === true && can(actor.role, "contact:create");
  const cache = new Map<string, Promise<DomainResearch>>();
  const lookups: Lookup[] = [];
  const results: CsvResultRow[] = [];
  let enriched = 0;
  let failed = 0;
  for (const [index, input] of rows.entries()) {
    let result: CsvResultRow;
    try {
      result = await enrichCsvRow(actor, input, index, cache, lookups);
      if (save) result.saved = await saveRow(actor, result);
    } catch (error) {
      log.warn("csv enrichment row failed", { component: "enrichment", jobId: job.id, row: index + 1, error });
      result = {
        row: index + 1,
        firstName: input.firstName,
        lastName: input.lastName,
        company: input.company,
        domain: input.domain,
        inputEmail: input.email,
        email: null,
        status: null,
        source: null,
        confidence: null,
        sourceUrl: null,
        note: "This row couldn't be checked.",
        saved: null,
      };
    }
    results.push(result);
    if (result.email && result.status !== "invalid" && result.status !== "disposable") enriched += 1;
    else failed += 1;
    if ((index + 1) % 10 === 0 || index === rows.length - 1) {
      await progress(job.id, { processed: index + 1, enriched, failed, result: { rows: results } });
    }
  }
  await progress(job.id, {
    status: "completed",
    processed: rows.length,
    enriched,
    failed,
    finishedAt: new Date(),
    result: { rows: results },
  });
  await recordLookups(actor, lookups, { csv_enrichment_row: rows.length });
}

/* ------------------------------ Records ----------------------------------- */

async function enrichContact(actor: Actor, contact: ContactRow, staleBefore: Date): Promise<RecordOutcome> {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || "Unnamed contact";
  const base = { entityType: "contact" as const, id: contact.id, name };
  if (contact.email) {
    const suppressed = await suppressionChecker(actor.organizationId, [contact.email]);
    if (suppressed(contact.email)) return { ...base, action: "skipped", detail: "On the do-not-contact list." };
    const due =
      contact.emailStatus === "unverified" ||
      contact.emailStatus === "unknown" ||
      !contact.emailVerifiedAt ||
      contact.emailVerifiedAt < staleBefore;
    if (!due) return { ...base, action: "skipped", detail: "Verified recently." };
    if (!can(actor.role, "contact:update")) return { ...base, action: "skipped", detail: "No permission to update." };
    // Empty details (title, phone, LinkedIn, location) from the workspace's own data providers, on the
    // same cadence as re-verification so a provider's credits aren't spent on every run.
    const filled = await fillContactFromProviders(actor, contact);
    const extra = filled.fields.length
      ? ` ${filled.fields.length} field${filled.fields.length === 1 ? "" : "s"} filled from a data provider.`
      : "";
    const result = await verifyEmail(contact.email, { organizationId: actor.organizationId, force: true });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.contact)
        .set({ emailStatus: result.status, emailVerifiedAt: now, lastEnrichedAt: now })
        .where(and(eq(schema.contact.id, contact.id), eq(schema.contact.organizationId, actor.organizationId)));
      await tx.insert(schema.fieldProvenance).values({
        organizationId: actor.organizationId,
        entityType: "contact",
        entityId: contact.id,
        field: "emailStatus",
        value: result.status,
        source: result.checks.confirmedBySend ? "send_history" : "verification",
        confidence: result.status === "unknown" ? 0.5 : 0.9,
        retrievedAt: now,
      });
    });
    await recordLookups(actor, [{ type: "email_verification", cached: result.cached }]);
    return { ...base, action: "verified", detail: `Email status: ${result.status.replace("_", "-")}.${extra}` };
  }
  const match = await matchPerson(actor, { contactId: contact.id, verify: true });
  if (match.person.saved && match.person.email) {
    return { ...base, action: "found_email", detail: `Found ${match.person.email} (${match.person.emailSource}).` };
  }
  return { ...base, action: "no_email_found", detail: "No address found. Add a company domain to help." };
}

async function enrichCompany(actor: Actor, companyId: string, reuse: boolean): Promise<RecordOutcome> {
  const result = await enrichOrganization(actor, { companyId, reuse });
  const name = result.organization.name ?? "Company";
  const set = result.fields.filter((f) => f.action === "set").length;
  if (result.status !== "completed" && !set) {
    return { entityType: "company", id: companyId, name, action: "failed", detail: result.error ?? "Crawl failed." };
  }
  const fromProviders = result.fields.filter((f) => f.action === "set" && f.source.startsWith("provider:")).length;
  if (fromProviders) {
    return {
      entityType: "company",
      id: companyId,
      name,
      action: "enriched",
      detail: `${set} field${set === 1 ? "" : "s"} updated (${fromProviders} from a data provider).`,
    };
  }
  return {
    entityType: "company",
    id: companyId,
    name,
    action: "enriched",
    detail: set ? `${set} field${set === 1 ? "" : "s"} updated from the website.` : "Nothing new on the website.",
  };
}

async function runRecordsJob(actor: Actor, job: JobRow): Promise<void> {
  const options = optionsOf(job);
  const contactIds = (Array.isArray(options.contactIds) ? options.contactIds : []) as string[];
  const companyIds = (Array.isArray(options.companyIds) ? options.companyIds : []) as string[];
  const verifyDays =
    typeof options.verifyOlderThanDays === "number" ? options.verifyOlderThanDays : STALE_VERIFICATION_DAYS;
  const staleBefore = new Date(Date.now() - verifyDays * DAY_MS);
  const reuse = !options.automationId;
  const outcomes: RecordOutcome[] = [];
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  const tick = async () => {
    processed += 1;
    if (processed % 10 === 0) {
      await progress(job.id, { processed, enriched, failed, result: { outcomes: outcomes.slice(0, 2000) } });
    }
  };

  for (let i = 0; i < contactIds.length; i += 200) {
    const batch = contactIds.slice(i, i + 200);
    const rows = await db
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, job.organizationId), inArray(schema.contact.id, batch)));
    for (const contact of rows) {
      try {
        const outcome = await enrichContact(actor, contact, staleBefore);
        outcomes.push(outcome);
        if (outcome.action === "verified" || outcome.action === "found_email") enriched += 1;
        else if (outcome.action === "no_email_found" || outcome.action === "failed") failed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof HttpError ? error.message : "Couldn't enrich this contact.";
        outcomes.push({
          entityType: "contact",
          id: contact.id,
          name: contact.email ?? contact.id,
          action: "failed",
          detail: message,
        });
      }
      await tick();
    }
  }
  for (const companyId of companyIds) {
    try {
      const outcome = await enrichCompany(actor, companyId, reuse);
      outcomes.push(outcome);
      if (outcome.action === "enriched") enriched += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof HttpError ? error.message : "Couldn't enrich this company.";
      outcomes.push({ entityType: "company", id: companyId, name: companyId, action: "failed", detail: message });
    }
    await tick();
  }
  await progress(job.id, {
    status: "completed",
    processed,
    enriched,
    failed,
    finishedAt: new Date(),
    result: { outcomes: outcomes.slice(0, 2000) },
  });
}

/* -------------------------------------------------------------------------- */
/* Automation                                                                 */
/* -------------------------------------------------------------------------- */

export const automationInput = z
  .object({
    enabled: z.boolean(),
    verifyOlderThanDays: z.number().int().min(7).max(365),
    recrawlOlderThanDays: z.number().int().min(7).max(365),
    everyDays: z.number().int().min(1).max(90),
  })
  .strict();
export type AutomationSettings = z.infer<typeof automationInput>;

export const DEFAULT_AUTOMATION: AutomationSettings = {
  enabled: false,
  verifyOlderThanDays: 90,
  recrawlOlderThanDays: 90,
  everyDays: 7,
};

export interface AutomationView extends AutomationSettings {
  lastRunAt: string | null;
  nextRunAt: string | null;
}

async function automationRow(organizationId: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(schema.enrichmentJob)
    .where(
      and(
        eq(schema.enrichmentJob.organizationId, organizationId),
        sql`${schema.enrichmentJob.options}->>'automation' = 'true'`,
      ),
    )
    .orderBy(desc(schema.enrichmentJob.createdAt))
    .limit(1);
  return row ?? null;
}

function automationView(row: JobRow | null): AutomationView {
  const o = row ? optionsOf(row) : {};
  const schedule = automationInput.safeParse(o.schedule);
  const settings = schedule.success ? schedule.data : DEFAULT_AUTOMATION;
  const lastRunAt = typeof o.lastRunAt === "string" ? o.lastRunAt : null;
  const next = settings.enabled
    ? new Date((lastRunAt ? Date.parse(lastRunAt) : Date.now()) + (lastRunAt ? settings.everyDays * DAY_MS : 0))
    : null;
  return { ...settings, lastRunAt, nextRunAt: next?.toISOString() ?? null };
}

export async function getAutomation(actor: Actor): Promise<AutomationView> {
  return automationView(await automationRow(actor.organizationId));
}

export async function saveAutomation(actor: Actor, input: AutomationSettings): Promise<AutomationView> {
  const existing = await automationRow(actor.organizationId);
  if (existing) {
    const options = { ...optionsOf(existing), automation: true, schedule: input };
    await db.update(schema.enrichmentJob).set({ options }).where(eq(schema.enrichmentJob.id, existing.id));
  } else {
    await db.insert(schema.enrichmentJob).values({
      organizationId: actor.organizationId,
      kind: "records",
      status: "completed",
      options: { automation: true, schedule: input },
      createdById: actor.userId,
      finishedAt: new Date(),
    });
  }
  await audit(actor, "enrichment_automation.update", "enrichment_job", existing?.id ?? null, { ...input });
  return getAutomation(actor);
}

/** Spawn a records job for every workspace whose automation is due. */
export async function runDueAutomations(): Promise<number> {
  const rows = await db
    .select()
    .from(schema.enrichmentJob)
    .where(sql`${schema.enrichmentJob.options}->>'automation' = 'true'`);
  let spawned = 0;
  for (const row of rows) {
    const view = automationView(row);
    if (!view.enabled || (view.nextRunAt && Date.parse(view.nextRunAt) > Date.now())) continue;
    const staleVerify = new Date(Date.now() - view.verifyOlderThanDays * DAY_MS);
    const staleCrawl = new Date(Date.now() - view.recrawlOlderThanDays * DAY_MS);
    const [contacts, companies] = await Promise.all([
      db
        .select({ id: schema.contact.id })
        .from(schema.contact)
        .where(
          and(
            eq(schema.contact.organizationId, row.organizationId),
            sql`${schema.contact.email} is not null`,
            or(isNull(schema.contact.emailVerifiedAt), lt(schema.contact.emailVerifiedAt, staleVerify)),
          ),
        )
        .limit(RECORDS_MAX_IDS),
      db
        .select({ id: schema.company.id })
        .from(schema.company)
        .where(
          and(
            eq(schema.company.organizationId, row.organizationId),
            or(sql`${schema.company.domain} is not null`, sql`${schema.company.websiteUrl} is not null`),
            or(isNull(schema.company.lastEnrichedAt), lt(schema.company.lastEnrichedAt, staleCrawl)),
          ),
        )
        .limit(200),
    ]);
    const now = new Date().toISOString();
    await db
      .update(schema.enrichmentJob)
      .set({ options: { ...optionsOf(row), lastRunAt: now } })
      .where(eq(schema.enrichmentJob.id, row.id));
    if (!contacts.length && !companies.length) continue;
    await db.insert(schema.enrichmentJob).values({
      organizationId: row.organizationId,
      kind: "records",
      total: contacts.length + companies.length,
      options: {
        contactIds: contacts.map((c) => c.id),
        companyIds: companies.map((c) => c.id),
        verifyOlderThanDays: view.verifyOlderThanDays,
        automationId: row.id,
      },
      createdById: row.createdById,
    });
    spawned += 1;
  }
  return spawned;
}

/** Queued and running jobs, for the "View scheduled jobs" drawer. */
export async function activeJobs(actor: Actor): Promise<EnrichmentJobView[]> {
  const rows = await db
    .select()
    .from(schema.enrichmentJob)
    .where(
      and(
        eq(schema.enrichmentJob.organizationId, actor.organizationId),
        notAutomationConfig,
        inArray(schema.enrichmentJob.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(schema.enrichmentJob.createdAt))
    .limit(50);
  return rows.map(jobView);
}
