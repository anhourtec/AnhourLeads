import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { safeFetch } from "@/server/crawler/fetch";
import { type EnqueueResult, enqueue } from "@/server/crawler/fleet/frontier";
import { normalizeUrl } from "@/server/crawler/url";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { log } from "@/server/log";

import { companyDomainFor, hostKey, isReservedHost } from "./classify";
import { fleetConfig } from "./config";
import { isDeniedUrl } from "./denylist";
import { type CompanyPatch, type SourceEntry, upsertIndexCompany } from "./index-store";
import {
  buildRegistryWebsiteQuery,
  COMPANIES_HOUSE_API,
  COMPANIES_HOUSE_LICENSE,
  COMPANIES_HOUSE_PAUSE_MS,
  companiesHouseAuth,
  companiesHouseOfficersPage,
  companiesHousePage,
  normalizeCompanyNumber,
  paddedCik,
  parseCompaniesHouseOfficers,
  parseCompaniesHouseProfile,
  parseCompaniesHouseSearch,
  parseOwnershipDocument,
  parseRegistryWebsites,
  parseSecSubmissions,
  parseSecTickers,
  type RegistryEnv,
  type RegistryKind,
  type RegistryOfficer,
  type RegistryRequirement,
  type RegistryWebsite,
  registryRequirement,
  SEC_DATA,
  SEC_LICENSE,
  SEC_PAUSE_MS,
  SEC_WWW,
  secFilingDocumentUrl,
  secFilingIndexUrl,
} from "./registries";
import { attachRegistryId, companyByRegistryId, NameMatcher, recordRegistryOfficers } from "./registry-store";
import { WIKIDATA_ENDPOINT, WIKIDATA_LICENSE, wikidataRequestUrl } from "./wikidata";

/**
 * Runs for the official-registry seed sources (Companies House, SEC EDGAR). Each run is bounded
 * (`maxCompanies` candidates and `maxMinutes`), resumable (a cursor kept in the source's stats),
 * idempotent (companies upsert by domain and registry id, people by company + name) and polite
 * (Companies House at one request a second, SEC at five, both backing off on 429).
 *
 * A registry company needs a website domain to enter the index. The domain comes from Wikidata
 * (P2622 / P5531 with P856), then the SEC's own `website` field, then an existing index company
 * with exactly the same name (only when one company has it). Companies without one are skipped and
 * counted, never invented.
 */

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => normalizeUrl(v) !== null, "Enter an http or https URL.");

/** Endpoint overrides point the source at local fixtures: tests and CRAWLER_ALLOW_PRIVATE_HOSTS only. */
const testEndpoint = httpUrl.refine(
  () => env().CRAWLER_ALLOW_PRIVATE_HOSTS,
  "Custom endpoints are only for tests (CRAWLER_ALLOW_PRIVATE_HOSTS=true).",
);
const everyDays = z.number().int().min(1).max(365);

export const companiesHouseConfig = z.strictObject({
  /** Candidates looked at per run. */
  maxCompanies: z.number().int().min(1).max(5_000).optional(),
  maxMinutes: z.number().int().min(1).max(120).optional(),
  everyDays: everyDays.optional(),
  /** Read active companies with these SIC codes (advanced search) instead of the Wikidata list. */
  sicCodes: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\d{4,5}$/, "Use 5-digit SIC codes such as 62012."),
    )
    .max(20)
    .optional(),
  endpoint: testEndpoint.optional(),
  wikidataEndpoint: testEndpoint.optional(),
});

export const secEdgarConfig = z.strictObject({
  maxCompanies: z.number().int().min(1).max(10_000).optional(),
  maxMinutes: z.number().int().min(1).max(120).optional(),
  everyDays: everyDays.optional(),
  /** Officers and directors come from Forms 3 and 4 filed in this many days. */
  formLookbackDays: z.number().int().min(30).max(1_825).optional(),
  /** Ownership filings read per company (each is one request). */
  maxFilingsPerCompany: z.number().int().min(1).max(50).optional(),
  endpoint: testEndpoint.optional(),
  dataEndpoint: testEndpoint.optional(),
  wikidataEndpoint: testEndpoint.optional(),
});

type ChConfig = z.infer<typeof companiesHouseConfig>;
type SecConfig = z.infer<typeof secEdgarConfig>;

export const REGISTRY_DEFAULTS = {
  companies_house: { maxCompanies: 200, maxMinutes: 10, everyDays: 7 },
  sec_edgar: { maxCompanies: 300, maxMinutes: 15, everyDays: 7, formLookbackDays: 730, maxFilingsPerCompany: 12 },
} as const;

export function registryEnv(): RegistryEnv {
  return {
    companiesHouseApiKey: process.env.COMPANIES_HOUSE_API_KEY ?? null,
    secUserAgent: process.env.SEC_USER_AGENT ?? null,
    allowPrivate: env().CRAWLER_ALLOW_PRIVATE_HOSTS,
  };
}

function overridden(kind: RegistryKind, config: Record<string, unknown>): boolean {
  return kind === "companies_house" ? Boolean(config.endpoint) : Boolean(config.endpoint || config.dataEndpoint);
}

/** What the source still needs from the environment before it can run (null when ready). */
export function requirementFor(kind: RegistryKind, config: Record<string, unknown>): RegistryRequirement | null {
  return registryRequirement(kind, registryEnv(), overridden(kind, config));
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

const TOTAL_KEYS = ["companiesAdded", "companiesMatched", "skippedNoWebsite", "peopleAdded"] as const;

export interface RegistryStats {
  fetched: number;
  companies: number;
  companiesAdded: number;
  companiesMatched: number;
  skippedNoWebsite: number;
  skippedBadWebsite: number;
  skippedInactive: number;
  skippedNotFound: number;
  skippedOptedOut: number;
  skippedSharedDomain: number;
  peopleAdded: number;
  peopleUpdated: number;
  peopleOptedOut: number;
  peopleGone: number;
  requests: number;
  queued: number;
  requeued: number;
  skipped: number;
  errors: string[];
  /** Where the next run starts. */
  cursor: number;
  /** Size of the candidate list this pass walks (when known). */
  candidates: number | null;
  /** The run reached the end of the list; the next run starts again from the top. (Not "pass…": the logger redacts such keys.) */
  reachedEnd: boolean;
  /** Since the source was created. */
  totals: Record<(typeof TOTAL_KEYS)[number], number>;
}

function newStats(previous: Record<string, unknown> | null): RegistryStats {
  const prevTotals = (previous?.totals ?? {}) as Record<string, unknown>;
  const totals = Object.fromEntries(
    TOTAL_KEYS.map((k) => [k, typeof prevTotals[k] === "number" ? (prevTotals[k] as number) : 0]),
  ) as RegistryStats["totals"];
  const prevCursor = typeof previous?.cursor === "number" && previous.reachedEnd !== true ? previous.cursor : 0;
  return {
    fetched: 0,
    companies: 0,
    companiesAdded: 0,
    companiesMatched: 0,
    skippedNoWebsite: 0,
    skippedBadWebsite: 0,
    skippedInactive: 0,
    skippedNotFound: 0,
    skippedOptedOut: 0,
    skippedSharedDomain: 0,
    peopleAdded: 0,
    peopleUpdated: 0,
    peopleOptedOut: 0,
    peopleGone: 0,
    requests: 0,
    queued: 0,
    requeued: 0,
    skipped: 0,
    errors: [],
    cursor: prevCursor,
    candidates: null,
    reachedEnd: false,
    totals,
  };
}

function finish(stats: RegistryStats): RegistryStats {
  for (const k of TOTAL_KEYS) stats.totals[k] += stats[k];
  stats.companies = stats.companiesAdded + stats.companiesMatched;
  return stats;
}

function addEnqueue(stats: RegistryStats, r: EnqueueResult) {
  stats.queued += r.queued;
  stats.requeued += r.requeued;
  stats.skipped += r.skipped;
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

class RateLimited extends Error {}
class OutOfTime extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One registry's HTTP client: a fixed pause between requests, our headers, a timeout and a size
 * cap; on 429 / 503 it waits (Retry-After, else a minute) and tries once more, then gives up the
 * run (the cursor keeps its place). Only fixed registry hosts are fetched (fixture hosts in tests).
 */
class RegistryClient {
  private last = 0;
  requests = 0;

  constructor(
    private readonly pauseMs: number,
    private readonly headers: Record<string, string>,
    private readonly deadline: number,
  ) {}

  async get(url: string, maxBytes = 20_000_000): Promise<{ status: number; body: string | null }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = this.last + this.pauseMs - Date.now();
      if (wait > 0) await sleep(wait);
      if (Date.now() > this.deadline) throw new OutOfTime();
      this.last = Date.now();
      this.requests += 1;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { accept: "application/json, application/xml, text/xml;q=0.9, */*;q=0.5", ...this.headers },
          signal: AbortSignal.timeout(30_000),
          redirect: "follow",
        });
      } catch (error) {
        log.warn("registry request failed", { component: "discovery", url, error });
        return { status: 0, body: null };
      }
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel();
        if (attempt === 1) throw new RateLimited(`HTTP ${res.status} from ${new URL(url).host}`);
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        const backoff = Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 60_000, 300_000);
        if (Date.now() + backoff > this.deadline) throw new RateLimited(`HTTP ${res.status} from ${new URL(url).host}`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { status: res.status, body: null };
      }
      const length = Number(res.headers.get("content-length") ?? "0");
      if (length > maxBytes) {
        await res.body?.cancel();
        return { status: 413, body: null };
      }
      const body = await res.text();
      return { status: res.status, body: body.length > maxBytes ? null : body };
    }
    return { status: 0, body: null };
  }
}

/* -------------------------------------------------------------------------- */
/* Wikidata: registry id → website                                            */
/* -------------------------------------------------------------------------- */

const WEBSITE_PAGE = 2_000;
const WEBSITE_CACHE_MS = 60 * 60 * 1000;
const websiteCache = new Map<string, { at: number; map: Map<string, RegistryWebsite> }>();

/** Every registry id Wikidata knows a website for (a few thousand per registry), cached for an hour. */
async function websiteMap(
  kind: RegistryKind,
  endpoint: string,
  stats: RegistryStats,
): Promise<Map<string, RegistryWebsite>> {
  const key = `${kind}|${endpoint}`;
  const cached = websiteCache.get(key);
  if (cached && Date.now() - cached.at < WEBSITE_CACHE_MS) return cached.map;
  const fleet = fleetConfig();
  const map = new Map<string, RegistryWebsite>();
  for (let offset = 0; offset < 100_000; offset += WEBSITE_PAGE) {
    if (offset > 0) await sleep(2_000);
    const res = await safeFetch(wikidataRequestUrl(endpoint, buildRegistryWebsiteQuery(kind, WEBSITE_PAGE, offset)), {
      userAgent: fleet.userAgent,
      allowPrivate: fleet.allowPrivate,
      timeoutMs: 60_000,
      maxBytes: 20_000_000,
      maxRedirects: 2,
      expect: "json",
    });
    if (!res.ok) {
      stats.errors.push(
        `Wikidata websites (offset ${offset}): ${res.reason}${res.status ? ` (HTTP ${res.status})` : ""}`,
      );
      break;
    }
    const { rows, items } = parseRegistryWebsites(kind, res.body);
    for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
    if (items < WEBSITE_PAGE) break;
  }
  if (map.size) websiteCache.set(key, { at: Date.now(), map });
  return map;
}

/* -------------------------------------------------------------------------- */
/* One registry company                                                       */
/* -------------------------------------------------------------------------- */

interface Candidate {
  kind: RegistryKind;
  id: string;
  /** Name to match existing index companies by, when no website is known. */
  name: string | null;
  wikidata: RegistryWebsite | null;
  /** A website the registry itself publishes (SEC `website`). */
  registryWebsite: string | null;
}

type CompanyRow = typeof schema.indexCompany.$inferSelect;

interface Resolved {
  company: CompanyRow;
  added: boolean;
}

interface RunContext {
  sourceId: string;
  stats: RegistryStats;
  matcher: NameMatcher;
  allowPrivate: boolean;
}

/** The homepage for a website, or null when it may not enter the index (deny-list, reserved host). */
function homepageFor(website: string, allowPrivate: boolean): URL | null {
  const site = normalizeUrl(website);
  if (!site) return null;
  const home = new URL("/", site.origin);
  if (isDeniedUrl(home)) return null;
  if (!allowPrivate && isReservedHost(hostKey(home))) return null;
  return home;
}

/**
 * Find or create the index company for a registry company and record its registry id. Returns null
 * (and counts why) when it has no usable website, is opted out, or its website already belongs to
 * another company in the same registry.
 */
async function resolveCompany(
  ctx: RunContext,
  candidate: Candidate,
  patch: CompanyPatch,
  source: SourceEntry,
): Promise<Resolved | null> {
  const { stats } = ctx;
  let company = await companyByRegistryId(candidate.kind, candidate.id);
  let home: URL | null = null;
  let viaWikidata = false;
  let added = false;
  if (!company) {
    const website = candidate.wikidata?.website ?? candidate.registryWebsite;
    if (website) {
      home = homepageFor(website, ctx.allowPrivate);
      viaWikidata = Boolean(candidate.wikidata);
      if (!home) {
        stats.skippedBadWebsite += 1;
        return null;
      }
    } else {
      company = await ctx.matcher.match(candidate.name);
      if (!company) {
        stats.skippedNoWebsite += 1;
        return null;
      }
    }
  }
  const domain = company?.domain ?? (home ? companyDomainFor(home) : null);
  if (!domain) {
    stats.skippedNoWebsite += 1;
    return null;
  }
  if (!company) {
    const [existing] = await db
      .select()
      .from(schema.indexCompany)
      .where(eq(schema.indexCompany.domain, domain))
      .limit(1);
    if (existing) {
      const held = candidate.kind === "companies_house" ? existing.companiesHouseNumber : existing.secCik;
      if (held && held !== candidate.id) {
        stats.skippedSharedDomain += 1;
        return null;
      }
    } else added = true;
  }
  const now = new Date().toISOString();
  if (viaWikidata && candidate.wikidata && home) {
    const wd = await upsertIndexCompany(
      domain,
      { name: candidate.wikidata.label, websiteUrl: home.origin },
      {
        source: "wikidata",
        url: `https://www.wikidata.org/wiki/${candidate.wikidata.qid}`,
        retrievedAt: now,
        fields: candidate.wikidata.label ? ["name", "websiteUrl"] : ["websiteUrl"],
        license: WIKIDATA_LICENSE,
      },
    );
    if (!wd) {
      stats.skippedOptedOut += 1;
      return null;
    }
  }
  const fields = Object.entries(patch)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k]) => k);
  const row = await upsertIndexCompany(
    domain,
    { ...patch, websiteUrl: home?.origin ?? company?.websiteUrl ?? null },
    { ...source, retrievedAt: now, fields },
  );
  if (!row) {
    stats.skippedOptedOut += 1;
    return null;
  }
  if (!(await attachRegistryId(row, candidate.kind, candidate.id))) {
    stats.skippedSharedDomain += 1;
    return null;
  }
  ctx.matcher.claim(row);
  if (added) stats.companiesAdded += 1;
  else stats.companiesMatched += 1;
  if (row.websiteUrl) {
    const homepage = homepageFor(row.websiteUrl, ctx.allowPrivate);
    if (homepage) {
      addEnqueue(
        stats,
        await enqueue([{ url: homepage.toString(), kind: "homepage", discoveredFrom: `seed:${ctx.sourceId}` }]),
      );
    }
  }
  const fresh = await companyByRegistryId(candidate.kind, candidate.id);
  return { company: fresh ?? row, added };
}

async function writeOfficers(
  ctx: RunContext,
  company: CompanyRow,
  kind: RegistryKind,
  officers: Array<RegistryOfficer & { sourceUrl: string }>,
  markGone: boolean,
) {
  const write = await recordRegistryOfficers(company, kind, officers, { markGone });
  ctx.stats.peopleAdded += write.added;
  ctx.stats.peopleUpdated += write.updated;
  ctx.stats.peopleOptedOut += write.optedOut;
  ctx.stats.peopleGone += write.gone;
}

/* -------------------------------------------------------------------------- */
/* Companies House                                                            */
/* -------------------------------------------------------------------------- */

async function companiesHouseRun(sourceId: string, config: ChConfig, stats: RegistryStats): Promise<void> {
  const renv = registryEnv();
  const allowPrivate = renv.allowPrivate;
  const api = (allowPrivate && config.endpoint ? config.endpoint : COMPANIES_HOUSE_API).replace(/\/+$/, "");
  const wikidataEndpoint = allowPrivate && config.wikidataEndpoint ? config.wikidataEndpoint : WIKIDATA_ENDPOINT;
  const maxCompanies = config.maxCompanies ?? REGISTRY_DEFAULTS.companies_house.maxCompanies;
  const deadline = Date.now() + (config.maxMinutes ?? REGISTRY_DEFAULTS.companies_house.maxMinutes) * 60_000;
  const key = renv.companiesHouseApiKey?.trim();
  const client = new RegistryClient(
    COMPANIES_HOUSE_PAUSE_MS,
    {
      "user-agent": fleetConfig().userAgent,
      ...(key ? { authorization: companiesHouseAuth(key) } : {}),
    },
    deadline,
  );
  const ctx: RunContext = { sourceId, stats, matcher: new NameMatcher("companies_house"), allowPrivate };
  try {
    await companiesHouseCandidates(ctx, config, client, api, wikidataEndpoint, maxCompanies);
  } finally {
    stats.requests += client.requests;
  }
}

async function companiesHouseCandidates(
  ctx: RunContext,
  config: ChConfig,
  client: RegistryClient,
  api: string,
  wikidataEndpoint: string,
  maxCompanies: number,
): Promise<void> {
  const { stats } = ctx;
  const websites = await websiteMap("companies_house", wikidataEndpoint, stats);

  const processOne = async (number: string, searchName: string | null) => {
    const wikidata = websites.get(number) ?? null;
    // Cheap checks first: without a known website or an existing company, no request is made.
    const known = await companyByRegistryId("companies_house", number);
    if (!known && !wikidata && !(await ctx.matcher.match(searchName))) {
      stats.skippedNoWebsite += 1;
      return;
    }
    const profileRes = await client.get(`${api}/company/${number}`);
    const profile = profileRes.body ? parseCompaniesHouseProfile(profileRes.body) : null;
    if (!profile) {
      stats.skippedNotFound += 1;
      if (profileRes.status !== 404) stats.errors.push(`company ${number}: HTTP ${profileRes.status}`);
      return;
    }
    if (!profile.active) {
      stats.skippedInactive += 1;
      return;
    }
    const resolved = await resolveCompany(
      ctx,
      { kind: "companies_house", id: number, name: searchName ?? profile.name, wikidata, registryWebsite: null },
      {
        name: wikidata?.label ?? profile.name,
        city: profile.city,
        region: profile.region,
        country: profile.country,
        foundedYear: profile.foundedYear,
      },
      {
        source: "companies_house",
        url: companiesHousePage(number),
        retrievedAt: "",
        fields: [],
        license: COMPANIES_HOUSE_LICENSE,
      },
    );
    if (!resolved) return;
    const officers: RegistryOfficer[] = [];
    let complete = true;
    for (let start = 0, total = 1; start < Math.min(total, 300); start += 100) {
      const res = await client.get(`${api}/company/${number}/officers?items_per_page=100&start_index=${start}`);
      if (!res.body) {
        complete = res.status === 404 && start === 0;
        break;
      }
      const page = parseCompaniesHouseOfficers(res.body);
      officers.push(...page.officers);
      total = page.total;
      if (page.items < 100) break;
    }
    if (!complete) return;
    const sourceUrl = companiesHouseOfficersPage(number);
    await writeOfficers(
      ctx,
      resolved.company,
      "companies_house",
      officers.map((o) => ({ ...o, sourceUrl })),
      true,
    );
  };

  if (config.sicCodes?.length) {
    // Advanced search: active companies with these SIC codes, 100 per page.
    let start = stats.cursor;
    let examined = 0;
    while (examined < maxCompanies) {
      const params = new URLSearchParams({
        sic_codes: config.sicCodes.join(","),
        company_status: "active",
        size: "100",
        start_index: String(start),
      });
      const res = await client.get(`${api}/advanced-search/companies?${params}`);
      if (!res.body) {
        if (res.status !== 404) stats.errors.push(`advanced search: HTTP ${res.status}`);
        else stats.reachedEnd = true;
        break;
      }
      const page = parseCompaniesHouseSearch(res.body);
      stats.candidates = page.hits;
      if (!page.items.length) {
        stats.reachedEnd = true;
        break;
      }
      for (const item of page.items) {
        if (examined >= maxCompanies) break;
        stats.fetched += 1;
        examined += 1;
        await processOne(item.number, item.name);
        start += 1;
        stats.cursor = start;
      }
      if (start >= page.hits) {
        stats.reachedEnd = true;
        break;
      }
    }
    return;
  }

  // Default: every company Wikidata links to a Companies House number and a website.
  const numbers = [...websites.keys()].sort();
  stats.candidates = numbers.length;
  if (!numbers.length) return;
  let i = stats.cursor;
  for (; i < numbers.length && stats.fetched < maxCompanies; i++) {
    const number = normalizeCompanyNumber(numbers[i]);
    stats.fetched += 1;
    if (number) await processOne(number, null);
    stats.cursor = i + 1;
  }
  if (stats.cursor >= numbers.length) stats.reachedEnd = true;
}

/* -------------------------------------------------------------------------- */
/* SEC EDGAR                                                                  */
/* -------------------------------------------------------------------------- */

const SEC_COMPANY_PAGE = (cik: string) => `${SEC_WWW}/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik(cik)}`;

async function secRun(sourceId: string, config: SecConfig, stats: RegistryStats): Promise<void> {
  const renv = registryEnv();
  const allowPrivate = renv.allowPrivate;
  const www = (allowPrivate && config.endpoint ? config.endpoint : SEC_WWW).replace(/\/+$/, "");
  const data = (allowPrivate && config.dataEndpoint ? config.dataEndpoint : SEC_DATA).replace(/\/+$/, "");
  const wikidataEndpoint = allowPrivate && config.wikidataEndpoint ? config.wikidataEndpoint : WIKIDATA_ENDPOINT;
  const defaults = REGISTRY_DEFAULTS.sec_edgar;
  const maxCompanies = config.maxCompanies ?? defaults.maxCompanies;
  const maxFilings = config.maxFilingsPerCompany ?? defaults.maxFilingsPerCompany;
  const lookbackDays = config.formLookbackDays ?? defaults.formLookbackDays;
  const deadline = Date.now() + (config.maxMinutes ?? defaults.maxMinutes) * 60_000;
  const userAgent = renv.secUserAgent?.trim() || fleetConfig().userAgent;
  const client = new RegistryClient(SEC_PAUSE_MS, { "user-agent": userAgent }, deadline);
  const ctx: RunContext = { sourceId, stats, matcher: new NameMatcher("sec_edgar"), allowPrivate };
  try {
    await secCandidates(ctx, client, { www, data, wikidataEndpoint, maxCompanies, maxFilings, lookbackDays });
  } finally {
    stats.requests += client.requests;
  }
}

async function secCandidates(
  ctx: RunContext,
  client: RegistryClient,
  opts: {
    www: string;
    data: string;
    wikidataEndpoint: string;
    maxCompanies: number;
    maxFilings: number;
    lookbackDays: number;
  },
): Promise<void> {
  const { stats } = ctx;
  const { www, data, wikidataEndpoint, maxCompanies, maxFilings, lookbackDays } = opts;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const tickersRes = await client.get(`${www}/files/company_tickers.json`);
  const tickers = tickersRes.body ? parseSecTickers(tickersRes.body) : [];
  if (!tickers.length) {
    stats.errors.push(`company_tickers.json: HTTP ${tickersRes.status}`);
    return;
  }
  stats.candidates = tickers.length;
  const websites = await websiteMap("sec_edgar", wikidataEndpoint, stats);

  let i = stats.cursor;
  for (; i < tickers.length && stats.fetched < maxCompanies; i++) {
    const ticker = tickers[i];
    if (!ticker) continue;
    stats.fetched += 1;
    const subRes = await client.get(`${data}/submissions/CIK${paddedCik(ticker.cik)}.json`);
    const sub = subRes.body ? parseSecSubmissions(subRes.body, since) : null;
    if (!sub) {
      stats.skippedNotFound += 1;
      if (subRes.status !== 404) stats.errors.push(`CIK ${ticker.cik}: HTTP ${subRes.status}`);
      stats.cursor = i + 1;
      continue;
    }
    const resolved = await resolveCompany(
      ctx,
      {
        kind: "sec_edgar",
        id: ticker.cik,
        name: sub.name ?? ticker.name,
        wikidata: websites.get(ticker.cik) ?? null,
        registryWebsite: sub.website,
      },
      {
        name: sub.name ?? ticker.name,
        industry: sub.industry,
        city: sub.city,
        region: sub.region,
        country: sub.country,
      },
      { source: "sec_edgar", url: SEC_COMPANY_PAGE(ticker.cik), retrievedAt: "", fields: [], license: SEC_LICENSE },
    );
    if (resolved) {
      // Newest filing first: a person's latest role wins.
      const byName = new Map<string, RegistryOfficer & { sourceUrl: string }>();
      for (const filing of sub.ownershipFilings.slice(0, maxFilings)) {
        const res = await client.get(secFilingDocumentUrl(www, ticker.cik, filing), 5_000_000);
        if (!res.body) continue;
        for (const officer of parseOwnershipDocument(res.body)) {
          const key = officer.fullName.toLowerCase();
          if (!byName.has(key))
            byName.set(key, { ...officer, sourceUrl: secFilingIndexUrl(www, ticker.cik, filing.accession) });
        }
      }
      // Only a sample of filings is read, so people missing from it are not marked gone; they age out
      // through retention when no recent filing names them again.
      await writeOfficers(ctx, resolved.company, "sec_edgar", [...byName.values()], false);
    }
    stats.cursor = i + 1;
  }
  if (stats.cursor >= tickers.length) stats.reachedEnd = true;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Run a registry source from where its last run stopped. Returns the run's stats (cursor and
 * running totals included); never throws for registry or network trouble, which is reported in
 * `errors`.
 */
export async function runRegistrySource(
  kind: RegistryKind,
  sourceId: string,
  rawConfig: Record<string, unknown>,
  previous: Record<string, unknown> | null,
): Promise<RegistryStats> {
  const stats = newStats(previous);
  const requirement = requirementFor(kind, rawConfig);
  if (requirement) {
    stats.errors.push(requirement.message);
    return finish(stats);
  }
  const started = Date.now();
  try {
    if (kind === "companies_house") await companiesHouseRun(sourceId, companiesHouseConfig.parse(rawConfig), stats);
    else await secRun(sourceId, secEdgarConfig.parse(rawConfig), stats);
  } catch (error) {
    if (error instanceof RateLimited) stats.errors.push(`Rate limited (${error.message}); the next run resumes here.`);
    else if (!(error instanceof OutOfTime)) {
      log.error("registry run failed", { component: "discovery", sourceId, kind, error });
      stats.errors.push(error instanceof Error ? error.message.slice(0, 200) : "run failed");
    }
  }
  if (stats.reachedEnd) stats.cursor = 0;
  stats.errors = stats.errors.slice(0, 20);
  log.info("registry run", { component: "discovery", sourceId, kind, durationMs: Date.now() - started });
  return finish(stats);
}
