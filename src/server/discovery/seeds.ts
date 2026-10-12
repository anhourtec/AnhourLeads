import "server-only";

import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { safeFetch } from "@/server/crawler/fetch";
import { type EnqueueResult, enqueue } from "@/server/crawler/fleet/frontier";
import type { PipelineToggles } from "@/server/crawler/fleet/process";
import { normalizeUrl } from "@/server/crawler/url";
import { db, schema } from "@/server/db";
import { conflict, notFound } from "@/server/http/errors";
import { log } from "@/server/log";

import { ATS_PROVIDERS, type AtsEndpoints, atsApiUrl } from "./ats";
import { companyDomainFor, seedUrlsFromText } from "./classify";
import { fleetConfig } from "./config";
import { isDeniedUrl } from "./denylist";
import { upsertIndexCompany } from "./index-store";
import {
  buildWikidataQuery,
  isQid,
  parseWikidataResults,
  WIKIDATA_ENDPOINT,
  WIKIDATA_LICENSE,
  wikidataRequestUrl,
} from "./wikidata";

/**
 * Seed sources (seed_source): where the crawler fleet gets its starting points. Managed by
 * platform administrators. Each run is idempotent: companies upsert by domain and URLs are unique
 * in the frontier.
 */

export const SEED_KINDS = ["wikidata", "domain_list", "sitemap", "manual", "ats_boards"] as const;
export type SeedKind = (typeof SEED_KINDS)[number];

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => normalizeUrl(v) !== null, "Enter an http or https URL.");
const qids = z.array(z.string().trim().refine(isQid, "Use Wikidata item ids such as Q30.")).max(50);
const everyDays = z.number().int().min(1).max(365);

const wikidataConfig = z.strictObject({
  endpoint: httpUrl.optional(),
  countries: qids.optional(),
  industries: qids.optional(),
  maxRows: z.number().int().min(1).max(50_000).optional(),
  pageSize: z.number().int().min(1).max(1000).optional(),
  everyDays: everyDays.optional(),
});
const listConfig = z.strictObject({
  domains: z.array(z.string().trim().min(3).max(300)).max(10_000).optional(),
  everyDays: everyDays.optional(),
});
const sitemapConfig = z.strictObject({
  maxCompanies: z.number().int().min(1).max(50_000).optional(),
  everyDays: everyDays.optional(),
});
const atsConfig = z.strictObject({
  endpoints: z.partialRecord(z.enum(ATS_PROVIDERS), httpUrl).optional(),
  boards: z
    .array(
      z.strictObject({
        provider: z.enum(ATS_PROVIDERS),
        token: z
          .string()
          .trim()
          .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/i, "Use the board's token from its URL."),
        domain: z.string().trim().min(3).max(300),
      }),
    )
    .max(1000)
    .optional(),
  everyDays: everyDays.optional(),
});

const CONFIG_SCHEMAS = {
  wikidata: wikidataConfig,
  domain_list: listConfig,
  manual: listConfig,
  sitemap: sitemapConfig,
  ats_boards: atsConfig,
} as const;

/** Validate a source's config for its kind; list kinds also accept pasted or uploaded text. */
function parseConfig(kind: SeedKind, config: unknown, text?: string): Record<string, unknown> {
  const parsed = CONFIG_SCHEMAS[kind].parse(config ?? {}) as Record<string, unknown>;
  if ((kind === "domain_list" || kind === "manual") && text) {
    const existing = Array.isArray(parsed.domains) ? (parsed.domains as string[]) : [];
    parsed.domains = [...new Set([...existing, ...seedUrlsFromText(text)])].slice(0, 10_000);
  }
  if (kind === "domain_list" || kind === "manual") {
    const domains = Array.isArray(parsed.domains) ? (parsed.domains as string[]) : [];
    parsed.domains = seedUrlsFromText(domains.join("\n"));
  }
  return parsed;
}

export const seedCreateInput = z.strictObject({
  kind: z.enum(SEED_KINDS),
  name: z.string().trim().min(1, "Give the source a name.").max(120),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  /** domain_list / manual: CSV or plain text with one domain or URL per line. */
  text: z.string().max(2_000_000).optional(),
});

export const seedUpdateInput = z.strictObject({
  name: z.string().trim().min(1, "Give the source a name.").max(120).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(2_000_000).optional(),
});

type SeedRow = typeof schema.seedSource.$inferSelect;

export interface SeedSourceView {
  id: string;
  kind: SeedKind;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** domain_list / manual: how many homepages the list holds (the list itself can be long). */
  domainCount: number | null;
  lastRunAt: string | null;
  stats: Record<string, unknown> | null;
  createdAt: string;
}

export function seedView(row: SeedRow): SeedSourceView {
  const domains = Array.isArray(row.config.domains) ? (row.config.domains as unknown[]) : null;
  const config = { ...row.config };
  if (domains && domains.length > 50) config.domains = [...domains.slice(0, 50), `… ${domains.length - 50} more`];
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    config,
    domainCount: domains ? domains.length : null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    stats: row.stats ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A fresh installation gets one source of each built-in kind (only job boards on by default). */
export async function ensureDefaultSources(): Promise<void> {
  const [any] = await db.select({ id: schema.seedSource.id }).from(schema.seedSource).limit(1);
  if (any) return;
  await db.insert(schema.seedSource).values([
    {
      kind: "wikidata",
      name: "Wikidata businesses",
      enabled: false,
      config: { endpoint: WIKIDATA_ENDPOINT, maxRows: 500, pageSize: 200, everyDays: 30 },
    },
    { kind: "sitemap", name: "Company sitemaps", enabled: false, config: { maxCompanies: 500, everyDays: 30 } },
    { kind: "ats_boards", name: "Public job boards", enabled: true, config: { everyDays: 1 } },
    { kind: "manual", name: "Added by hand", enabled: true, config: { domains: [] } },
  ]);
}

export async function listSeedSources(): Promise<SeedSourceView[]> {
  await ensureDefaultSources();
  const rows = await db
    .select()
    .from(schema.seedSource)
    .orderBy(asc(schema.seedSource.createdAt), asc(schema.seedSource.name));
  return rows.map(seedView);
}

async function seedRow(id: string): Promise<SeedRow> {
  const [row] = await db.select().from(schema.seedSource).where(eq(schema.seedSource.id, id)).limit(1);
  if (!row) throw notFound("Seed source not found.");
  return row;
}

export async function getSeedSource(id: string): Promise<SeedSourceView> {
  return seedView(await seedRow(id));
}

export async function createSeedSource(input: z.infer<typeof seedCreateInput>): Promise<SeedSourceView> {
  const config = parseConfig(input.kind, input.config, input.text);
  const [row] = await db
    .insert(schema.seedSource)
    .values({ kind: input.kind, name: input.name, enabled: input.enabled ?? false, config })
    .returning();
  if (!row) throw new Error("seed source insert failed");
  return seedView(row);
}

export async function updateSeedSource(id: string, input: z.infer<typeof seedUpdateInput>): Promise<SeedSourceView> {
  const row = await seedRow(id);
  const merged = input.config ? { ...row.config, ...input.config } : row.config;
  const config = input.config || input.text ? parseConfig(row.kind, merged, input.text) : row.config;
  const [updated] = await db
    .update(schema.seedSource)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      config,
    })
    .where(eq(schema.seedSource.id, id))
    .returning();
  if (!updated) throw notFound("Seed source not found.");
  return seedView(updated);
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                       */
/* -------------------------------------------------------------------------- */

export interface SeedRunStats {
  fetched: number;
  companies: number;
  queued: number;
  requeued: number;
  skipped: number;
  errors: string[];
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WIKIDATA_PAUSE_MS = 2_000;

function addEnqueue(stats: SeedRunStats, r: EnqueueResult) {
  stats.queued += r.queued;
  stats.requeued += r.requeued;
  stats.skipped += r.skipped;
}

async function runWikidata(row: SeedRow, stats: SeedRunStats): Promise<void> {
  const config = wikidataConfig.parse(row.config);
  const fleet = fleetConfig();
  const endpoint = config.endpoint ?? WIKIDATA_ENDPOINT;
  const maxRows = config.maxRows ?? 500;
  const pageSize = Math.min(config.pageSize ?? 200, maxRows);
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    if (offset > 0) await sleep(WIKIDATA_PAUSE_MS);
    const query = buildWikidataQuery(config, Math.min(pageSize, maxRows - offset), offset);
    const res = await safeFetch(wikidataRequestUrl(endpoint, query), {
      userAgent: fleet.userAgent,
      allowPrivate: fleet.allowPrivate,
      timeoutMs: 60_000,
      maxBytes: 20_000_000,
      maxRedirects: 2,
      expect: "json",
    });
    if (!res.ok) {
      stats.errors.push(`offset ${offset}: ${res.reason}${res.status ? ` (HTTP ${res.status})` : ""}`);
      break;
    }
    const { rows, count } = parseWikidataResults(res.body);
    stats.fetched += rows.length;
    for (const item of rows) {
      const site = normalizeUrl(item.website);
      if (!site) continue;
      const home = new URL("/", site.origin);
      if (isDeniedUrl(home)) {
        addEnqueue(
          stats,
          await enqueue([{ url: home.toString(), kind: "homepage", discoveredFrom: `seed:${row.id}` }]),
        );
        continue;
      }
      const company = await upsertIndexCompany(
        companyDomainFor(home),
        {
          name: item.name,
          websiteUrl: home.origin,
          industry: item.industry,
          country: item.country,
          city: item.city,
          employeeCount: item.employeeCount,
          foundedYear: item.foundedYear,
        },
        {
          source: "wikidata",
          url: `https://www.wikidata.org/wiki/${item.qid}`,
          retrievedAt: new Date().toISOString(),
          fields: Object.entries(item)
            .filter(([k, v]) => v !== null && k !== "qid" && k !== "website")
            .map(([k]) => k),
          license: WIKIDATA_LICENSE,
        },
        // Structured Wikidata values beat what a crawl guessed for these fields.
        { overwrite: ["industry", "country", "employeeCount", "foundedYear"] },
      );
      if (!company) {
        stats.skipped += 1;
        continue;
      }
      stats.companies += 1;
      addEnqueue(stats, await enqueue([{ url: home.toString(), kind: "homepage", discoveredFrom: `seed:${row.id}` }]));
    }
    if (count < pageSize) break;
  }
}

async function runDomainList(row: SeedRow, stats: SeedRunStats, refresh: boolean): Promise<void> {
  const domains = Array.isArray(row.config.domains)
    ? (row.config.domains as unknown[]).filter((d): d is string => typeof d === "string")
    : [];
  stats.fetched = domains.length;
  for (let i = 0; i < domains.length; i += 500) {
    const batch = domains
      .slice(i, i + 500)
      .map((url) => ({ url, kind: "homepage" as const, discoveredFrom: `seed:${row.id}` }));
    addEnqueue(stats, await enqueue(batch, { refresh }));
  }
}

async function runSitemaps(row: SeedRow, stats: SeedRunStats): Promise<void> {
  const config = sitemapConfig.parse(row.config);
  const companies = await db
    .select({ websiteUrl: schema.indexCompany.websiteUrl, domain: schema.indexCompany.domain })
    .from(schema.indexCompany)
    .where(isNotNull(schema.indexCompany.websiteUrl))
    .orderBy(asc(schema.indexCompany.lastCrawledAt))
    .limit(config.maxCompanies ?? 500);
  stats.fetched = companies.length;
  const items = companies.flatMap((c) => {
    const site = c.websiteUrl ? normalizeUrl(c.websiteUrl) : null;
    return site
      ? [
          {
            url: new URL("/sitemap.xml", site.origin).toString(),
            kind: "sitemap" as const,
            depth: 1,
            discoveredFrom: `seed:${row.id}`,
          },
        ]
      : [];
  });
  for (let i = 0; i < items.length; i += 500)
    addEnqueue(stats, await enqueue(items.slice(i, i + 500), { refresh: true }));
}

async function runAtsBoards(row: SeedRow, stats: SeedRunStats): Promise<void> {
  const config = atsConfig.parse(row.config);
  // Listed boards are queued directly; boards found on careers pages are refreshed.
  const items = (config.boards ?? []).flatMap((b) => {
    const site = normalizeUrl(/^[a-z]+:\/\//i.test(b.domain) ? b.domain : `https://${b.domain}`);
    return site
      ? [
          {
            url: atsApiUrl(b, config.endpoints ?? {}),
            kind: "ats" as const,
            discoveredFrom: new URL("/", site.origin).toString(),
          },
        ]
      : [];
  });
  if (items.length) addEnqueue(stats, await enqueue(items, { refresh: true }));
  const refreshed = await db
    .update(schema.crawlFrontier)
    .set({ status: "queued", nextAttemptAt: new Date(), attempts: 0 })
    .where(and(eq(schema.crawlFrontier.kind, "ats"), eq(schema.crawlFrontier.status, "done")))
    .returning({ id: schema.crawlFrontier.id });
  stats.requeued += refreshed.length;
  stats.fetched = items.length + refreshed.length;
}

const running = new Set<string>();

/** Run one seed source now. One run per source at a time in this process. */
export async function runSeedSource(id: string, options: { refresh?: boolean } = {}): Promise<SeedSourceView> {
  const row = await seedRow(id);
  if (running.has(id)) throw conflict("This source is already running.");
  running.add(id);
  const stats: SeedRunStats = { fetched: 0, companies: 0, queued: 0, requeued: 0, skipped: 0, errors: [] };
  const started = Date.now();
  try {
    if (row.kind === "wikidata") await runWikidata(row, stats);
    else if (row.kind === "domain_list" || row.kind === "manual")
      await runDomainList(row, stats, options.refresh ?? false);
    else if (row.kind === "sitemap") await runSitemaps(row, stats);
    else await runAtsBoards(row, stats);
  } catch (error) {
    log.error("seed source run failed", { component: "discovery", sourceId: id, kind: row.kind, error });
    stats.errors.push(error instanceof Error ? error.message.slice(0, 200) : "run failed");
  } finally {
    running.delete(id);
  }
  stats.durationMs = Date.now() - started;
  log.info("seed source run", { component: "discovery", sourceId: id, kind: row.kind, ...stats });
  const [updated] = await db
    .update(schema.seedSource)
    .set({ lastRunAt: new Date(), stats })
    .where(eq(schema.seedSource.id, id))
    .returning();
  return seedView(updated ?? row);
}

/** Enabled sources whose interval has passed (for the discovery job). */
export async function dueSeedSources(): Promise<SeedRow[]> {
  const rows = await db
    .select()
    .from(schema.seedSource)
    .where(
      and(
        eq(schema.seedSource.enabled, true),
        or(isNull(schema.seedSource.lastRunAt), lt(schema.seedSource.lastRunAt, sql`now() - interval '1 day'`)),
      ),
    );
  return rows.filter((r) => {
    const days = typeof r.config.everyDays === "number" ? r.config.everyDays : 7;
    return !r.lastRunAt || Date.now() - r.lastRunAt.getTime() >= days * 24 * 60 * 60 * 1000;
  });
}

/** What the fleet should do besides plain pages: read job boards, follow sitemaps. */
export async function pipelineToggles(): Promise<PipelineToggles> {
  const rows = await db
    .select({ kind: schema.seedSource.kind, config: schema.seedSource.config })
    .from(schema.seedSource)
    .where(eq(schema.seedSource.enabled, true));
  const ats = rows.find((r) => r.kind === "ats_boards");
  const parsed = ats ? atsConfig.safeParse(ats.config) : null;
  const endpoints: AtsEndpoints = parsed?.success ? (parsed.data.endpoints ?? {}) : {};
  return { atsEnabled: Boolean(ats), atsEndpoints: endpoints, sitemapEnabled: rows.some((r) => r.kind === "sitemap") };
}
