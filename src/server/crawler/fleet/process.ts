import "server-only";

import {
  ATS_LABELS,
  type AtsEndpoints,
  atsApiUrl,
  atsBoardFromApiUrl,
  detectAtsBoards,
  parseAtsJobs,
} from "@/server/discovery/ats";
import {
  companyDomainFor,
  companyNameFromTitle,
  countryName,
  type FrontierKind,
  hostDelayMs,
  hostKey,
  isLinkOfInterest,
  isOtherLocale,
  KIND_PRIORITY,
  kindForUrl,
} from "@/server/discovery/classify";
import { type FleetConfig, fleetConfig } from "@/server/discovery/config";
import { isDeniedUrl } from "@/server/discovery/denylist";
import { feedLinks, parseFeed, parseSitemap } from "@/server/discovery/feeds";
import {
  type CompanyPatch,
  indexCompanyByDomain,
  type PersonInput,
  recordJobs,
  recordNews,
  recordPagePeople,
  refreshEmailPattern,
  upsertIndexCompany,
} from "@/server/discovery/index-store";
import { isOptedOut } from "@/server/discovery/optouts";
import { type PatternSample, patternsFor } from "@/server/email/patterns";
import { log } from "@/server/log";

import { extractPage } from "../extract";
import { type SafeFetchResult, safeFetch } from "../fetch";
import { ALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from "../robots";
import type { Fact, FactField, PageExtract, SkipReason } from "../types";
import { normalizeUrl, registrableDomain, sameSite } from "../url";
import { type Claim, enqueue, type Outcome, saveRobots } from "./frontier";

/**
 * Fetch and process one claimed frontier URL: robots.txt (cached per host for a day), the guarded
 * fetch (public addresses only, no cookies, no forms, no scripts), then extraction into the
 * discovery index and new same-site URLs of interest. Returns how the row should be settled.
 */

export interface PipelineToggles {
  atsEnabled: boolean;
  atsEndpoints: AtsEndpoints;
  sitemapEnabled: boolean;
}

export interface ProcessResult {
  outcome: Outcome;
  /** What was written, for logs and the run_once response. */
  stats: { people?: number; gone?: number; jobs?: number; news?: number; enqueued?: number };
}

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const ATS_MAX_BYTES = 16_000_000;
const TRANSIENT: ReadonlySet<SkipReason> = new Set(["timeout", "network", "dns"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransient(res: Extract<SafeFetchResult, { ok: false }>): boolean {
  if (TRANSIENT.has(res.reason)) return true;
  return res.reason === "http_error" && res.status !== null && (res.status === 429 || res.status >= 500);
}

function failure(res: Extract<SafeFetchResult, { ok: false }>, requested = true): Outcome {
  if (isTransient(res))
    return { type: "retry", reason: res.status ? `http_${res.status}` : res.reason, statusCode: res.status };
  if (res.reason === "http_error") {
    return {
      type: "failed",
      reason: res.status ? `http_${res.status}` : "http_error",
      statusCode: res.status,
      requested,
    };
  }
  return { type: "skipped", reason: res.reason, statusCode: res.status, requested };
}

/** robots.txt for the claimed host: cached in crawl_host, fetched when older than a day. */
async function robotsFor(
  claim: Claim,
  url: URL,
  config: FleetConfig,
): Promise<{ policy: RobotsPolicy; fetched: boolean } | { error: Outcome }> {
  const { host } = claim;
  const fresh = host.robotsFetchedAt && Date.now() - host.robotsFetchedAt.getTime() < ROBOTS_TTL_MS;
  if (fresh && host.robotsTxt !== null) {
    return { policy: host.robotsTxt ? parseRobots(host.robotsTxt, config.userAgent) : ALLOW_ALL, fetched: false };
  }
  const robotsUrl = new URL("/robots.txt", url.origin);
  const res = await safeFetch(robotsUrl, {
    userAgent: config.userAgent,
    allowPrivate: config.allowPrivate,
    timeoutMs: config.fetchTimeoutMs,
    maxBytes: 500 * 1024,
    maxRedirects: 3,
    expect: "text",
    checkHop: async (hop) => (sameSite(hop, url) ? null : "offsite"),
  });
  let text: string;
  if (res.ok) text = res.body;
  else if (
    (res.status !== null && res.status >= 400 && res.status < 500 && res.status !== 429) ||
    res.reason === "not_html" ||
    res.reason === "offsite"
  ) {
    // RFC 9309: an unavailable robots.txt (4xx) means no restrictions.
    text = "";
  } else if (res.reason === "blocked_host") {
    return { error: { type: "skipped", reason: "blocked_host", statusCode: null, requested: false } };
  } else {
    // Unreachable robots.txt (5xx, 429, network): assume a complete disallow for now and retry later.
    return { error: { type: "retry", reason: `robots_${res.status ?? res.reason}`, statusCode: res.status } };
  }
  const policy = text ? parseRobots(text, config.userAgent) : ALLOW_ALL;
  const delay = hostDelayMs(policy.crawlDelaySeconds, config.minDelayMs);
  const saved = await saveRobots(host.host, text, delay);
  if (saved) claim.host = saved;
  return { policy, fetched: true };
}

function bestFact(facts: Fact[], field: FactField): string | null {
  let best: Fact | null = null;
  for (const f of facts) if (f.field === field && (!best || f.confidence > best.confidence)) best = f;
  return best?.value ?? null;
}

function companyPatch(extract: PageExtract, url: URL, kind: FrontierKind): CompanyPatch {
  const facts = extract.facts;
  const year = (v: string | null) => (v && /^\d{4}$/.test(v) ? Number(v) : null);
  const employees = bestFact(facts, "employeeCount");
  return {
    name:
      bestFact(facts, "name") ??
      (kind === "homepage"
        ? companyNameFromTitle(bestFact(facts, "siteName"), extract.title, companyDomainFor(url))
        : bestFact(facts, "siteName")),
    websiteUrl: kind === "homepage" ? url.origin : null,
    description: bestFact(facts, "description"),
    phone: bestFact(facts, "phone") ?? extract.phones[0]?.value ?? null,
    foundedYear: year(bestFact(facts, "foundedYear")),
    employeeCount: employees && /^\d+$/.test(employees) ? Number(employees) : null,
    city: bestFact(facts, "city"),
    country: countryName(bestFact(facts, "country")),
    // Public profile links the company publishes itself: stored, never fetched.
    linkedinUrl: bestFact(facts, "linkedinUrl"),
    twitterUrl: bestFact(facts, "twitterUrl"),
    technologies: extract.technologies.map((t) => t.name),
  };
}

/** People on the page, each with the published address that belongs to them (if any). */
function pagePeople(extract: PageExtract, domain: string): { people: PersonInput[]; samples: PatternSample[] } {
  const siteDomain = registrableDomain(domain.replace(/:\d+$/, ""));
  const companyEmails = extract.emails
    .map((e) => e.email)
    .filter((e) => registrableDomain(e.split("@")[1] ?? "") === siteDomain);
  const samples: PatternSample[] = [];
  const people = extract.people.map((p) => {
    let email = p.email && companyEmails.includes(p.email.toLowerCase()) ? p.email.toLowerCase() : null;
    if (!email) email = companyEmails.find((e) => patternsFor(e, p.firstName, p.lastName).length > 0) ?? null;
    if (email) samples.push({ firstName: p.firstName, lastName: p.lastName, email });
    return {
      name: p.name,
      firstName: p.firstName,
      lastName: p.lastName,
      title: p.title,
      email,
      // A profile link published next to the person: stored as a plain URL, linkedin.com is never fetched.
      linkedinUrl: p.linkedinUrl,
    };
  });
  return { people, samples };
}

function fieldsOf(patch: CompanyPatch): string[] {
  return Object.entries(patch)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([k]) => k);
}

/** The company a frontier URL belongs to: its own site, or for job-board APIs the page that linked it. */
function companyDomainOf(claim: Claim): string | null {
  const ref = claim.row.kind === "ats" ? claim.row.discoveredFrom : claim.row.url;
  const url = ref ? normalizeUrl(ref) : null;
  return url ? companyDomainFor(url) : null;
}

async function processHtml(
  claim: Claim,
  url: URL,
  body: string,
  headers: Partial<Record<string, string>>,
  toggles: PipelineToggles,
  config: FleetConfig,
): Promise<ProcessResult> {
  const { row } = claim;
  const domain = companyDomainFor(url);
  const extract = extractPage(body, url.toString(), headers);
  const patch = companyPatch(extract, url, row.kind);
  const company = await upsertIndexCompany(
    domain,
    patch,
    { source: "crawl", url: url.toString(), retrievedAt: new Date().toISOString(), fields: fieldsOf(patch) },
    { crawled: true },
  );
  if (!company)
    return { outcome: { type: "skipped", reason: "opted_out", statusCode: 200, requested: true }, stats: {} };

  const { people, samples } = pagePeople(extract, domain);
  const peopleResult = await recordPagePeople(company, url.toString(), people);
  if (samples.length) await refreshEmailPattern(company, samples);

  // Same-site pages of interest (about, team, contact, careers), feeds and job boards.
  const items: Parameters<typeof enqueue>[0] = [];
  if (row.depth + 1 <= config.maxDepth) {
    for (const link of extract.links) {
      const next = normalizeUrl(link.url);
      if (!next || !sameSite(next, url) || isDeniedUrl(next) || isOtherLocale(next, url)) continue;
      const kind = kindForUrl(next);
      if (!isLinkOfInterest(kind)) continue;
      items.push({ url: next.toString(), kind, depth: row.depth + 1, discoveredFrom: url.toString() });
    }
  }
  for (const feed of feedLinks(body, url.toString())) {
    const feedUrl = new URL(feed);
    if (sameSite(feedUrl, url))
      items.push({ url: feed, kind: "rss", depth: row.depth + 1, discoveredFrom: url.toString() });
  }
  if (toggles.atsEnabled) {
    for (const board of detectAtsBoards(extract.links.map((l) => l.url))) {
      items.push({
        url: atsApiUrl(board, toggles.atsEndpoints),
        kind: "ats",
        priority: KIND_PRIORITY.ats,
        depth: row.depth + 1,
        discoveredFrom: url.toString(),
      });
    }
  }
  const queued = items.length ? await enqueue(items, { capPerHost: true }) : null;
  return {
    outcome: { type: "done", statusCode: 200, requested: true },
    stats: { people: peopleResult.written, gone: peopleResult.gone, enqueued: queued?.queued ?? 0 },
  };
}

async function processFeed(claim: Claim, url: URL, body: string): Promise<ProcessResult> {
  const domain = companyDomainOf(claim);
  if (!domain) return { outcome: { type: "skipped", reason: "unsupported", requested: true }, stats: {} };
  const items = parseFeed(body, url.toString());
  const company = await upsertIndexCompany(
    domain,
    {},
    { source: "rss", url: url.toString(), retrievedAt: new Date().toISOString(), fields: ["news"] },
  );
  if (!company)
    return { outcome: { type: "skipped", reason: "opted_out", statusCode: 200, requested: true }, stats: {} };
  const news = await recordNews(company, "rss", items);
  return { outcome: { type: "done", statusCode: 200, requested: true }, stats: { news } };
}

async function processSitemap(claim: Claim, url: URL, body: string): Promise<ProcessResult> {
  const { row } = claim;
  const map = parseSitemap(body, url.toString());
  const items: Parameters<typeof enqueue>[0] = [];
  if (row.depth + 1 <= 2) {
    for (const child of map.sitemaps.slice(0, 3)) {
      const next = normalizeUrl(child);
      if (next && sameSite(next, url))
        items.push({ url: child, kind: "sitemap", depth: row.depth + 1, discoveredFrom: url.toString() });
    }
  }
  let pages = 0;
  for (const loc of map.urls) {
    const next = normalizeUrl(loc);
    if (!next || !sameSite(next, url) || isDeniedUrl(next)) continue;
    const kind = kindForUrl(next);
    if (!isLinkOfInterest(kind) && kind !== "homepage") continue;
    items.push({ url: next.toString(), kind, depth: 1, discoveredFrom: url.toString() });
    if (++pages >= 10) break;
  }
  const queued = items.length ? await enqueue(items, { capPerHost: true }) : null;
  return { outcome: { type: "done", statusCode: 200, requested: true }, stats: { enqueued: queued?.queued ?? 0 } };
}

async function processAts(claim: Claim, url: URL, body: string): Promise<ProcessResult> {
  const board = atsBoardFromApiUrl(url.toString());
  const domain = companyDomainOf(claim);
  if (!board || !domain) return { outcome: { type: "skipped", reason: "unsupported", requested: true }, stats: {} };
  if (await isOptedOut({ domain })) {
    return { outcome: { type: "skipped", reason: "opted_out", statusCode: 200, requested: true }, stats: {} };
  }
  // A board listed by an operator can be read before the company's site has been crawled: the
  // company row is created from the domain and filled in when its homepage is.
  const company =
    (await indexCompanyByDomain(domain)) ??
    (await upsertIndexCompany(
      domain,
      { websiteUrl: `https://${domain}` },
      { source: `ats:${board.provider}`, url: url.toString(), retrievedAt: new Date().toISOString(), fields: [] },
    ));
  if (!company) {
    return { outcome: { type: "skipped", reason: "opted_out", statusCode: 200, requested: true }, stats: {} };
  }
  const jobs = parseAtsJobs(board.provider, body);
  const written = await recordJobs(company, ATS_LABELS[board.provider], jobs);
  await upsertIndexCompany(
    domain,
    {},
    {
      source: `ats:${board.provider}`,
      url: url.toString(),
      retrievedAt: new Date().toISOString(),
      fields: ["jobPostings"],
    },
  );
  return { outcome: { type: "done", statusCode: 200, requested: true }, stats: { jobs: written } };
}

const EXPECT: Record<FrontierKind, "html" | "xml" | "json"> = {
  homepage: "html",
  about: "html",
  team: "html",
  contact: "html",
  careers: "html",
  other: "html",
  sitemap: "xml",
  rss: "xml",
  ats: "json",
};

export async function processClaim(claim: Claim, toggles: PipelineToggles): Promise<ProcessResult> {
  const config = fleetConfig();
  const { row } = claim;
  const url = normalizeUrl(row.url);
  if (!url) return { outcome: { type: "skipped", reason: "unsupported", requested: false }, stats: {} };
  if (isDeniedUrl(url)) return { outcome: { type: "skipped", reason: "denylist", requested: false }, stats: {} };
  const domain = companyDomainOf(claim);
  if (domain && (await isOptedOut({ domain }))) {
    return { outcome: { type: "skipped", reason: "opted_out", requested: false }, stats: {} };
  }
  if (row.kind === "ats" && !toggles.atsEnabled) {
    return { outcome: { type: "skipped", reason: "unsupported", requested: false }, stats: {} };
  }

  const robots = await robotsFor(claim, url, config);
  if ("error" in robots) return { outcome: robots.error, stats: {} };
  if (!isAllowed(robots.policy, `${url.pathname}${url.search}`)) {
    return { outcome: { type: "skipped", reason: "robots", requested: robots.fetched }, stats: {} };
  }
  if (robots.fetched) {
    // robots.txt was a request too: keep the per-host pause before the page itself.
    await sleep(Math.max(config.minDelayMs, claim.host.crawlDelayMs));
    if (toggles.sitemapEnabled && robots.policy.sitemaps.length) {
      const maps = robots.policy.sitemaps
        .map((s) => normalizeUrl(s))
        .filter((s): s is URL => Boolean(s && sameSite(s, url)))
        .slice(0, 2);
      if (maps.length) {
        await enqueue(
          maps.map((m) => ({
            url: m.toString(),
            kind: "sitemap" as const,
            depth: 1,
            discoveredFrom: `${url.origin}/robots.txt`,
          })),
        );
      }
    }
  }

  const host = hostKey(url);
  let redirectedTo: URL | null = null;
  const res = await safeFetch(url, {
    userAgent: config.userAgent,
    allowPrivate: config.allowPrivate,
    timeoutMs: config.fetchTimeoutMs,
    // Job-board APIs return every open role with its full description in one document (Ashby:
    // 2–5 MB for a few hundred roles), so they get a larger cap than pages.
    maxBytes: row.kind === "ats" ? ATS_MAX_BYTES : config.maxPageBytes,
    maxRedirects: 3,
    expect: EXPECT[row.kind],
    // Pages and feeds are read up to the cap and parsed as far as they go (many homepages are
    // several MB of inline scripts); job-board JSON must be whole.
    truncate: EXPECT[row.kind] !== "json",
    checkHop: async (hop) => {
      if (isDeniedUrl(hop)) return "offsite";
      if (hostKey(hop) !== host) {
        redirectedTo = hop;
        return "offsite";
      }
      return isAllowed(robots.policy, `${hop.pathname}${hop.search}`) ? null : "robots";
    },
  });
  if (!res.ok) {
    // A redirect to another host on the same site (acme.com → www.acme.com) becomes its own URL,
    // with its own robots.txt and politeness.
    const target: URL | null = redirectedTo;
    if (res.reason === "offsite" && target && row.kind !== "ats" && sameSite(target, url) && !isDeniedUrl(target)) {
      await enqueue([
        { url: (target as URL).toString(), kind: row.kind, depth: row.depth, discoveredFrom: url.toString() },
      ]);
      return { outcome: { type: "skipped", reason: "redirected", statusCode: res.status, requested: true }, stats: {} };
    }
    // A seeded homepage that moved to another domain (notion.so → notion.com, dbtlabs.com →
    // getdbt.com): the company lives there now, so its new homepage is queued as a seed of its own.
    if (
      res.reason === "offsite" &&
      target &&
      row.kind === "homepage" &&
      row.depth === 0 &&
      !sameSite(target, url) &&
      !isDeniedUrl(target)
    ) {
      const home = new URL("/", (target as URL).origin);
      await enqueue([{ url: home.toString(), kind: "homepage", depth: 0, discoveredFrom: url.toString() }]);
      return { outcome: { type: "skipped", reason: "moved", statusCode: res.status, requested: true }, stats: {} };
    }
    return { outcome: failure(res), stats: {} };
  }

  const finalUrl = new URL(res.url);
  try {
    if (row.kind === "rss") return await processFeed(claim, finalUrl, res.body);
    if (row.kind === "sitemap") return await processSitemap(claim, finalUrl, res.body);
    if (row.kind === "ats") return await processAts(claim, finalUrl, res.body);
    return await processHtml(claim, finalUrl, res.body, res.headers, toggles, config);
  } catch (error) {
    log.error("discovery page processing failed", { component: "crawler-fleet", url: row.url, error });
    return {
      outcome: { type: "failed", reason: "processing_error", statusCode: res.status, requested: true },
      stats: {},
    };
  }
}
