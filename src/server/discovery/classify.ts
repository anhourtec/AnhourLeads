/**
 * Pure helpers for the discovery pipeline: page kinds, priorities, re-crawl intervals, back-off,
 * company keys, seniority and department from a job title, and seed-list parsing. No I/O, so the
 * unit tests import this file directly.
 */

import type { Seniority } from "../../lib/records-vocabulary";
import { EMPLOYEE_RANGES } from "../../lib/search/filters";
import { registrableDomain, seedUrlFrom } from "../crawler/url";

export const FRONTIER_KINDS = [
  "homepage",
  "about",
  "team",
  "contact",
  "careers",
  "sitemap",
  "rss",
  "ats",
  "other",
] as const;
export type FrontierKind = (typeof FRONTIER_KINDS)[number];

export const FRONTIER_STATUSES = ["queued", "fetching", "done", "failed", "skipped"] as const;
export type FrontierStatus = (typeof FRONTIER_STATUSES)[number];

/** Why a frontier URL was not fetched (crawl_frontier.skipped_reason). */
export const FRONTIER_SKIP_REASONS = [
  "robots",
  "denylist",
  "opted_out",
  "offsite",
  "blocked_host",
  "not_html",
  "too_large",
  "too_many_redirects",
  "http_error",
  "duplicate",
  "unsupported",
] as const;

/** Fetch order: the pages that name the company and its people first. */
export const KIND_PRIORITY: Record<FrontierKind, number> = {
  homepage: 100,
  team: 90,
  about: 85,
  contact: 80,
  careers: 80,
  ats: 75,
  rss: 70,
  sitemap: 60,
  other: 40,
};

/** Default re-crawl interval per kind, in days (platform settings may override). */
export const DEFAULT_RECRAWL_DAYS: Record<FrontierKind, number> = {
  homepage: 30,
  about: 30,
  team: 14,
  contact: 30,
  careers: 7,
  ats: 1,
  rss: 1,
  sitemap: 30,
  other: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function recrawlIntervalMs(kind: FrontierKind, overrides: Partial<Record<FrontierKind, number>> = {}): number {
  const days = overrides[kind] ?? DEFAULT_RECRAWL_DAYS[kind];
  return Math.max(1, days) * DAY_MS;
}

/** Exponential back-off after a failed attempt: 1 min, 2 min, 4 min… capped at one day. */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(DAY_MS, 60_000 * 2 ** (n - 1));
}

/** The politeness floor: never less than 2 s between requests to one host, whatever robots.txt says. */
export const MIN_HOST_DELAY_MS = 2_000;
/** A Crawl-delay above this is capped (and the host is crawled slowly rather than never). */
export const MAX_HOST_DELAY_MS = 60_000;

/** Delay between requests to a host: the floor, raised by robots.txt Crawl-delay (capped). */
export function hostDelayMs(crawlDelaySeconds: number | null, floorMs = MIN_HOST_DELAY_MS): number {
  const floor = Math.max(MIN_HOST_DELAY_MS, floorMs);
  if (crawlDelaySeconds === null || !Number.isFinite(crawlDelaySeconds)) return floor;
  return Math.max(floor, Math.min(MAX_HOST_DELAY_MS, Math.round(crawlDelaySeconds * 1000)));
}

/** Pages we look for on a company site, by path (trailing slash and .html ignored). */
const KIND_PATHS: Array<[RegExp, FrontierKind]> = [
  [/^\/?$/, "homepage"],
  [
    /^\/(?:team|our-team|the-team|people|leadership|management|founders|board|(?:about|about-us|company)\/(?:team|leadership|people|management))$/,
    "team",
  ],
  [/^\/(?:about|about-us|company|who-we-are)$/, "about"],
  [/^\/(?:contact|contact-us)$/, "contact"],
  [/^\/(?:careers|jobs|join-us|work-with-us|hiring|open-positions)$/, "careers"],
];

/** Classify a same-site HTML URL by its path. Query strings make a page "other". */
export function kindForUrl(url: URL): FrontierKind {
  if (url.search) return "other";
  const path = url.pathname
    .toLowerCase()
    .replace(/\/index\.html?$/, "/")
    .replace(/\.html?$/, "")
    .replace(/\/+$/, "");
  for (const [pattern, kind] of KIND_PATHS) if (pattern.test(path)) return kind;
  return "other";
}

/** Same-site links worth following: the pages that describe the company, its people and its hiring. */
export function isLinkOfInterest(kind: FrontierKind): boolean {
  return kind === "about" || kind === "team" || kind === "contact" || kind === "careers";
}

/** First path segments that are a non-English locale ("/de/", "/pt-br/", "/fr_CA/"). */
const OTHER_LOCALE =
  /^(?:de|fr|es|pt|it|nl|ja|ko|zh|sv|da|no|nb|fi|pl|ru|tr|cs|hu|ro|el|he|ar|th|id|vi|uk)(?:[-_][a-z]{2,4})?$/i;

const LOCALE_HOST =
  /^(?:de|fr|es|pt|it|nl|ja|jp|ko|kr|zh|cn|br|mx|sv|se|da|dk|no|fi|pl|ru|tr|cs|cz|hu|ro|el|gr|he|il|ar|th|id|vi|uk|ua)$/;

/**
 * A translated copy of a page: big sites link /de/about, /fr/about… from every page. The crawler
 * follows the page's own language only, so a site costs one set of pages and titles stay in the
 * language the site leads with.
 */
export function isOtherLocale(next: URL, current: URL): boolean {
  const first = (u: URL) => u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  const seg = first(next);
  if (OTHER_LOCALE.test(seg) && seg !== first(current)) return true;
  // Locale subdomains: de.acme.com, br.acme.com, jp.acme.com.
  const label = (u: URL) => u.hostname.toLowerCase().split(".")[0] ?? "";
  const sub = label(next);
  return next.hostname !== current.hostname && LOCALE_HOST.test(sub) && sub !== label(current);
}

/** crawl_host key: lowercase host with a non-default port ("acme.com", "127.0.0.1:48091"). */
export function hostKey(url: URL): string {
  return url.host.toLowerCase();
}

/**
 * The index_company key for a URL: its registrable domain, plus the port when it isn't the
 * default (only local test sites have one). "https://www.acme.co.uk/team" → "acme.co.uk".
 */
export function companyDomainFor(url: URL): string {
  const domain = registrableDomain(url.hostname);
  return url.port ? `${domain}:${url.port}` : domain;
}

/** The same key without the port, as stored on workspace companies ("acme.com"). */
export function bareDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/**
 * Homepage URLs from an uploaded domain list (CSV or plain text, one per line, any column):
 * tokens that look like a domain or URL, deduplicated by company, deny-listed hosts kept so the
 * caller can record why they were skipped. Explicit http/https schemes are kept.
 */
export function seedUrlsFromText(text: string, max = 10_000): string[] {
  const out = new Map<string, string>();
  for (const raw of text.split(/[\s,;|"']+/)) {
    const token = raw.trim();
    if (!token || token.length > 300) continue;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(token) && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\/?$/i.test(token)) continue;
    const url = seedUrlFrom(token);
    if (!url || !url.hostname.includes(".")) continue;
    const home = new URL("/", url.origin);
    const key = companyDomainFor(home);
    if (!out.has(key)) out.set(key, home.toString());
    if (out.size >= max) break;
  }
  return [...out.values()];
}

/* -------------------------------------------------------------------------- */
/* People: seniority and department from a title                              */
/* -------------------------------------------------------------------------- */

/**
 * The commonest leadership titles on European company sites (team pages are often not in English):
 * German, French, Spanish, Portuguese, Italian, Dutch and Nordic.
 */
const FOUNDER_INTL =
  /(?:^|[^\p{L}])(?:mit)?gr(?:ü|ue)nder(?:in)?|(?:co-?)?fondat(?:eur|rice|ore)|(?:co-?)?fundador(?:a)?|(?:mede)?oprichter|grundare|grundlægger/u;
const CSUITE_INTL =
  /gesch(?:ä|ae)ftsf(?:ü|ue)hrer(?:in)?|vorstand|dirigeant(?:e)?\b|amministratore unico|dagleg leiar|\bpdg\b|directeur g(?:é|e)n(?:é|e)ral|directrice g(?:é|e)n(?:é|e)rale|director(?:a)? general|diretor(?:a)? (?:geral|executiv[oa])|amministratore delegato|algemeen directeur|verkst(?:ä|a)llande direkt(?:ö|o)r|administrerende direkt(?:ø|o)r|daglig leder|toimitusjohtaja/u;

const SENIORITY_RULES: Array<[RegExp, Seniority]> = [
  [/\b(?:intern|internship|trainee|apprentice|working student)\b/, "intern"],
  [/\b(?:co-?founder|founder|founding partner)\b/, "founder"],
  [FOUNDER_INTL, "founder"],
  [CSUITE_INTL, "c_suite"],
  [/\b(?:owner|proprietor)\b/, "owner"],
  [/\b(?:vp|svp|evp|avp|vice[- ]president)\b/, "vp"],
  [/\b(?:chief|ceo|cto|cfo|coo|cmo|cio|cpo|cro|cso|ciso|president|managing director|general manager)\b/, "c_suite"],
  [/\b(?:partner|principal)\b/, "partner"],
  [/\bhead\b/, "head"],
  [/\bdirector\b/, "director"],
  [/\b(?:manager|lead|supervisor|team lead)\b/, "manager"],
  [/\b(?:senior|sr\.?|staff|expert)\b/, "senior"],
  [
    /\b(?:engineer|developer|associate|analyst|specialist|coordinator|assistant|representative|designer|consultant|executive|officer|scientist|writer|editor|accountant|recruiter|administrator|agent|technician)\b/,
    "entry",
  ],
];

/** "Former CFO, Atlassian" (board pages): a past role says nothing about this company. */
const PAST_ROLE = /(?:^|[\s,(])(?:former|formerly|ex-|previously)\b/;
/** "Executive Assistant to the CEO": the role is the assistant, whoever it supports. */
const SUPPORT_ROLE = /\b(?:assistant|ea|aide|secretary)\s+to\b/;

export function seniorityFromTitle(title: string | null | undefined): Seniority | null {
  const t = (title ?? "").toLowerCase();
  if (!t.trim() || PAST_ROLE.test(t)) return null;
  if (SUPPORT_ROLE.test(t)) return /\b(?:senior|sr\.?)\b/.test(t) ? "senior" : "entry";
  for (const [pattern, level] of SENIORITY_RULES) if (pattern.test(t)) return level;
  return null;
}

/** Departments use the same labels as workspace search (src/lib/search/filters.ts DEPARTMENTS). */
const DEPARTMENT_RULES: Array<[RegExp, string]> = [
  [FOUNDER_INTL, "C-Suite"],
  [CSUITE_INTL, "C-Suite"],
  [
    /\b(?:ceo|cto|cfo|coo|cmo|cio|cpo|cro|chief|founder|co-?founder|(?<!vice[- ])president|owner|managing director)\b/,
    "C-Suite",
  ],
  [
    /\b(?:sales|account executive|business development|bdr|sdr|account manager|revenue|partnerships|customer success)\b/,
    "Sales",
  ],
  [/\b(?:marketing|brand|content|growth|communications|pr|seo|demand gen|community)\b/, "Marketing"],
  [/\bproduct\b/, "Product"],
  [/\b(?:design|designer|ux|ui|creative)\b/, "Design"],
  [
    /\b(?:engineer|engineering|developer|software|devops|sre|architect|technical|data scientist|machine learning|qa)\b/,
    "Engineering & Technical",
  ],
  [
    /\b(?:it|information technology|systems administrator|helpdesk|security|infrastructure)\b/,
    "Information Technology",
  ],
  [/\b(?:finance|financial|accounting|accountant|controller|treasury|payroll)\b/, "Finance"],
  [/\b(?:hr|human resources|people|talent|recruiter|recruiting|recruitment)\b/, "Human Resources"],
  [/\b(?:legal|counsel|attorney|lawyer|compliance|paralegal)\b/, "Legal"],
  [/\b(?:medical|clinical|nurse|physician|doctor|health)\b/, "Medical & Health"],
  [/\b(?:operations|ops|logistics|supply chain|procurement|facilities)\b/, "Operations"],
  [/\b(?:consultant|consulting|advisor|adviser)\b/, "Consulting"],
  [/\b(?:teacher|professor|lecturer|education|instructor|tutor)\b/, "Education"],
];

export function departmentFromTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").toLowerCase();
  if (!t.trim() || PAST_ROLE.test(t)) return null;
  if (SUPPORT_ROLE.test(t)) return "Operations";
  for (const [pattern, department] of DEPARTMENT_RULES) if (pattern.test(t)) return department;
  return null;
}

/** "11-20" style range key for a head count (EMPLOYEE_RANGES), or null. */
export function employeeRangeFor(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count) || count < 1) return null;
  const range = EMPLOYEE_RANGES.find((r) => count >= r.min && (r.max === null || count <= r.max));
  return range?.key ?? null;
}

/** "Jane van der Berg" → first "Jane", last "van der Berg". */
export function splitFullName(name: string): { firstName: string | null; lastName: string | null } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: null, lastName: null };
  if (words.length === 1) return { firstName: words[0] ?? null, lastName: null };
  return { firstName: words[0] ?? null, lastName: words.slice(1).join(" ") };
}

/** Opt-out key for a person: "full name|domain", lowercase, single spaces, domain without port. */
export function personOptoutKey(fullName: string, domain: string): string {
  return `${fullName.trim().toLowerCase().replace(/\s+/g, " ")}|${bareDomain(domain)}`;
}

/**
 * Hosts (with an optional port) that are never real public sites: localhost, loopback addresses and
 * the reserved test names (RFC 2606 / 6761). Long-running workers don't claim them (the test
 * harness drives its local fixture sites itself through run_once). A POSIX regex that means the
 * same in Postgres (`~*`) and JavaScript (flag "i").
 */
export const RESERVED_HOST_PATTERN =
  "^(localhost|127\\.[0-9.]+|\\[::1\\]|[^:]+\\.(localhost|test|example|invalid|local))(:[0-9]+)?$";

export function isReservedHost(host: string): boolean {
  return new RegExp(RESERVED_HOST_PATTERN, "i").test(host);
}

/* -------------------------------------------------------------------------- */
/* Company name and country from page metadata                                */
/* -------------------------------------------------------------------------- */

/** Homepage titles that are just the page's name in some language, never the company's. */
const GENERIC_TITLES = new Set([
  "home",
  "homepage",
  "home page",
  "welcome",
  "startseite",
  "accueil",
  "inicio",
  "início",
  "hjem",
  "forside",
  "etusivu",
  "hem",
  "главная",
  "index",
]);

const squash = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The company's name from a site name and a homepage title such as "AI Innovation Workspace | Miro"
 * or "Elastic: The search database for AI": the part that matches the domain wins ("Miro",
 * "Elastic"), then the site name, then the title's first part. Generic titles ("Home",
 * "Startseite") give nothing.
 */
export function companyNameFromTitle(siteName: string | null, title: string | null, domain: string): string | null {
  const label = squash(registrableLabel(domain));
  const parts = (title ?? "")
    .split(/\s+[|–—·•:-]\s+|\s*[|–—·•]\s*|:\s+/)
    .map((p) => p.trim())
    .filter((p) => p && p.length <= 80 && !GENERIC_TITLES.has(p.toLowerCase()));
  const site = siteName?.trim() && !GENERIC_TITLES.has(siteName.trim().toLowerCase()) ? siteName.trim() : null;
  const matches = (v: string) => {
    const s = squash(v);
    return label.length >= 3 && s.length > 0 && (s.includes(label) || (s.length >= 3 && label.includes(s)));
  };
  return [site, ...parts].find((v): v is string => Boolean(v && matches(v))) ?? site ?? parts[0] ?? null;
}

function registrableLabel(domain: string): string {
  return domain.replace(/:\d+$/, "").split(".")[0] ?? domain;
}

const ISO3: Record<string, string> = {
  USA: "US",
  GBR: "GB",
  CAN: "CA",
  DEU: "DE",
  FRA: "FR",
  ESP: "ES",
  ITA: "IT",
  NLD: "NL",
  AUS: "AU",
  IND: "IN",
  BRA: "BR",
  JPN: "JP",
  CHE: "CH",
  SWE: "SE",
  NOR: "NO",
  DNK: "DK",
  FIN: "FI",
  IRL: "IE",
  SGP: "SG",
  ISR: "IL",
  POL: "PL",
  AUT: "AT",
  BEL: "BE",
  PRT: "PT",
  MEX: "MX",
  NZL: "NZ",
  CHN: "CN",
};

let regionNames: Intl.DisplayNames | null = null;

/**
 * Country names as Wikidata and workspace search use them ("United States"), from the codes sites
 * often publish in their address markup ("US", "USA", "GB"). Anything else is kept as given.
 */
export function countryName(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  let code: string | undefined;
  if (/^[A-Z]{3}$/.test(v)) code = ISO3[upper];
  else if (/^[A-Za-z]{2}$/.test(v)) code = upper;
  if (!code) return v;
  if (code === "UK") return "United Kingdom";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = regionNames.of(code);
    return name && name !== code ? name : v;
  } catch {
    return v;
  }
}
