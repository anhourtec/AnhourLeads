import { extractPage } from "./extract";
import { hostBlocked, safeFetch } from "./fetch";
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from "./robots";
import type { CrawlFindings, CrawlPageRecord, PageExtract, RobotsSummary, SkipReason } from "./types";
import { looksBinary, normalizeUrl, pagePriority, registrableDomain, sameSite } from "./url";

/** Hard limits. The per-job page cap comes from crawl_job.max_pages and can't exceed MAX_PAGES. */
export const MAX_PAGES = 25;
export const MAX_PAGE_BYTES = 1_000_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
const MIN_DELAY_MS = 400;
const MAX_CRAWL_DELAY_MS = 10_000;
const MAX_SKIP_RECORDS = 40;
const MAX_DEPTH = 2;

export interface CrawlOptions {
  seedUrl: string;
  maxPages: number;
  userAgent: string;
  allowPrivate: boolean;
  /** Minimum pause between requests (robots Crawl-delay may raise it). */
  minDelayMs?: number;
  /** Called as each page is fetched or skipped, so progress is visible while the job runs. */
  onPage?: (page: CrawlPageRecord) => Promise<void>;
}

export interface CrawlOutcome {
  pages: CrawlPageRecord[];
  fetched: number;
  findings: CrawlFindings;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Social and hiring hosts are findings, not offsite pages worth recording as skipped. */
const QUIET_OFFSITE =
  /(?:^|\.)(?:linkedin\.com|twitter\.com|x\.com|github\.com|facebook\.com|instagram\.com|youtube\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|google\.com|apple\.com)$/i;

function emptyFindings(seedUrl: string): CrawlFindings {
  return {
    seedUrl,
    domain: registrableDomain(new URL(seedUrl).hostname),
    facts: [],
    emails: [],
    phones: [],
    social: [],
    technologies: [],
    people: [],
    hiring: { careersUrl: null, jobCount: null, ats: [], mentions: [] },
    robots: null,
    emailPattern: null,
    suppressedEmails: 0,
  };
}

/** Merge one page's extract into the job findings, keeping the first source for duplicates. */
export function mergeFindings(into: CrawlFindings, page: PageExtract): void {
  const factKeys = new Set(into.facts.map((f) => `${f.field}|${f.value}`));
  for (const f of page.facts) {
    const key = `${f.field}|${f.value}`;
    if (f.field === "title" && into.facts.some((x) => x.field === "title")) continue;
    if (!factKeys.has(key)) {
      factKeys.add(key);
      into.facts.push(f);
    }
  }
  for (const e of page.emails) if (!into.emails.some((x) => x.email === e.email)) into.emails.push(e);
  for (const p of page.phones) {
    const digits = p.value.replace(/\D/g, "");
    if (!into.phones.some((x) => x.value.replace(/\D/g, "") === digits)) into.phones.push(p);
  }
  for (const s of page.social) if (!into.social.some((x) => x.url === s.url)) into.social.push(s);
  for (const t of page.technologies) if (!into.technologies.some((x) => x.name === t.name)) into.technologies.push(t);
  for (const person of page.people) {
    const existing = into.people.find((x) => x.name.toLowerCase() === person.name.toLowerCase());
    if (!existing) into.people.push(person);
    else if (existing.confidence < person.confidence)
      Object.assign(existing, person, { title: person.title ?? existing.title });
    else existing.title ??= person.title;
  }
  const h = page.hiring;
  into.hiring.careersUrl ??= h.careersUrl;
  if (h.jobCount !== null) into.hiring.jobCount = Math.max(into.hiring.jobCount ?? 0, h.jobCount);
  into.hiring.ats = [...new Set([...into.hiring.ats, ...h.ats])];
  into.hiring.mentions = [...new Set([...into.hiring.mentions, ...h.mentions])];
}

/**
 * Crawl one company website politely: robots.txt first (per origin), same registrable domain only,
 * key pages first, a pause between requests, at most `maxPages` fetches. Every fetched or skipped
 * URL is reported, with the reason it was skipped.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlOutcome> {
  const seed = normalizeUrl(options.seedUrl);
  if (!seed) throw new Error("The seed URL must be an http or https URL.");
  const maxPages = Math.max(1, Math.min(MAX_PAGES, options.maxPages));
  const findings = emptyFindings(seed.toString());
  const pages: CrawlPageRecord[] = [];
  const robotsByOrigin = new Map<string, RobotsPolicy>();
  /** Origins whose robots.txt couldn't be fetched at all, with the reason (blocked host, DNS, timeout…). */
  const unreachable = new Map<string, SkipReason>();
  const fetchOpts = {
    userAgent: options.userAgent,
    allowPrivate: options.allowPrivate,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_PAGE_BYTES,
    maxRedirects: MAX_REDIRECTS,
  };
  let lastRequestAt = 0;
  let delayMs = options.minDelayMs ?? MIN_DELAY_MS;
  let skips = 0;

  const pause = async () => {
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  };

  const record = async (page: CrawlPageRecord) => {
    if (page.skippedReason) {
      if (skips >= MAX_SKIP_RECORDS) return;
      skips += 1;
    }
    pages.push(page);
    await options.onPage?.(page);
  };

  const robotsFor = async (url: URL): Promise<RobotsPolicy> => {
    const cached = robotsByOrigin.get(url.origin);
    if (cached) return cached;
    const robotsUrl = new URL("/robots.txt", url.origin);
    await pause();
    const res = await safeFetch(robotsUrl, {
      ...fetchOpts,
      maxBytes: 500 * 1024,
      expect: "text",
      checkHop: async (hop) => (sameSite(hop, url) ? null : "offsite"),
    });
    let policy: RobotsPolicy;
    let status: RobotsSummary["status"];
    if (res.ok) {
      policy = parseRobots(res.body, options.userAgent);
      status = "found";
    } else if (res.status !== null && res.status >= 400 && res.status < 500) {
      // RFC 9309: an unavailable robots.txt (4xx) means no restrictions.
      policy = ALLOW_ALL;
      status = "missing";
    } else if (res.reason === "not_html" || res.reason === "offsite") {
      policy = ALLOW_ALL;
      status = "missing";
    } else {
      // Unreachable (5xx, network, timeout): assume complete disallow.
      policy = DISALLOW_ALL;
      status = "unreachable";
      if (!res.ok && res.status === null) unreachable.set(url.origin, res.reason);
    }
    robotsByOrigin.set(url.origin, policy);
    findings.robots ??= {
      url: robotsUrl.toString(),
      status,
      crawlDelaySeconds: policy.crawlDelaySeconds,
      matchedAgent: policy.matchedAgent,
      disallowRules: policy.rules.filter((r) => !r.allow).length,
    };
    if (policy.crawlDelaySeconds !== null) {
      delayMs = Math.max(delayMs, Math.min(MAX_CRAWL_DELAY_MS, policy.crawlDelaySeconds * 1000));
    }
    return policy;
  };

  const vet = async (url: URL): Promise<SkipReason | null> => {
    if (!sameSite(url, seed)) return "offsite";
    if (hostBlocked(url, options.allowPrivate)) return "blocked_host";
    const policy = await robotsFor(url);
    const down = unreachable.get(url.origin);
    if (down) return down;
    if (!isAllowed(policy, `${url.pathname}${url.search}`)) return "robots";
    return null;
  };

  interface QueueItem {
    url: URL;
    priority: number;
    depth: number;
  }
  const queue: QueueItem[] = [{ url: seed, priority: 1000, depth: 0 }];
  const seen = new Set<string>([seed.toString()]);
  let fetched = 0;

  while (queue.length && fetched < maxPages) {
    queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    const item = queue.shift() as QueueItem;
    const href = item.url.toString();

    if (looksBinary(item.url)) {
      await record({ url: href, statusCode: null, title: null, skippedReason: "not_html" });
      continue;
    }
    const veto = await vet(item.url);
    if (veto) {
      await record({ url: href, statusCode: null, title: null, skippedReason: veto });
      continue;
    }

    await pause();
    const res = await safeFetch(item.url, { ...fetchOpts, expect: "html", checkHop: vet });
    fetched += 1;
    if (!res.ok) {
      await record({ url: href, statusCode: res.status, title: null, skippedReason: res.reason });
      continue;
    }
    if (res.url !== href && seen.has(res.url)) {
      await record({ url: href, statusCode: res.status, title: null, skippedReason: "duplicate" });
      continue;
    }
    seen.add(res.url);

    const extract = extractPage(res.body, res.url, res.headers);
    mergeFindings(findings, extract);
    await record({ url: res.url, statusCode: res.status, title: extract.title, skippedReason: null });

    for (const link of extract.links) {
      const next = normalizeUrl(link.url);
      if (!next) continue;
      const key = next.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!sameSite(next, seed)) {
        // Offsite links are never fetched. Links from the start page are listed so it's visible.
        if (item.depth === 0 && !QUIET_OFFSITE.test(next.hostname)) {
          await record({ url: key, statusCode: null, title: null, skippedReason: "offsite" });
        }
        continue;
      }
      if (item.depth + 1 > MAX_DEPTH) continue;
      queue.push({ url: next, priority: pagePriority(next) - item.depth * 10, depth: item.depth + 1 });
    }
  }

  return { pages, fetched, findings };
}
