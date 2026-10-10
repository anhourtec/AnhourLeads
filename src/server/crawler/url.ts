import { isIpLiteral } from "./ip";

/** Second-level public suffixes common enough to matter when deciding "same site". */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "ltd.uk",
  "plc.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "net.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.br",
  "net.br",
  "org.br",
  "co.in",
  "net.in",
  "org.in",
  "firm.in",
  "co.za",
  "org.za",
  "com.mx",
  "com.cn",
  "net.cn",
  "org.cn",
  "com.sg",
  "com.tr",
  "co.kr",
  "or.kr",
  "com.hk",
  "com.tw",
  "co.il",
  "com.ar",
  "com.co",
  "com.my",
  "com.ph",
  "com.pk",
  "com.ng",
  "co.id",
  "co.th",
  "com.vn",
  "com.ua",
  "com.pl",
  "co.at",
  "com.es",
  "com.pt",
  "com.sa",
  "com.eg",
]);

const BINARY_EXTENSIONS =
  /\.(?:pdf|zip|gz|tgz|rar|7z|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp3|mp4|m4a|mov|avi|wmv|webm|ogg|wav|docx?|xlsx?|pptx?|csv|json|xml|rss|atom|txt|js|mjs|css|woff2?|ttf|otf|eot|exe|dmg|pkg|apk|iso)$/i;

/** Lowercase hostname without a trailing dot and without IPv6 brackets. */
export function cleanHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

/** The registrable domain ("eTLD+1") of a hostname: www.app.acme.co.uk → acme.co.uk. IPs return themselves. */
export function registrableDomain(hostname: string): string {
  const host = cleanHost(hostname);
  if (isIpLiteral(host) || !host.includes(".")) return host;
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function sameSite(a: URL | string, b: URL | string): boolean {
  const ha = typeof a === "string" ? new URL(a).hostname : a.hostname;
  const hb = typeof b === "string" ? new URL(b).hostname : b.hostname;
  return registrableDomain(ha) === registrableDomain(hb);
}

/**
 * Parse and normalise a crawlable URL: http/https only, no credentials, no fragment, lowercase host,
 * default port removed. Returns null for anything else (mailto:, javascript:, data:, malformed).
 */
export function normalizeUrl(raw: string, base?: string | URL): URL | null {
  let url: URL;
  try {
    url = base ? new URL(raw.trim(), base) : new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  return url;
}

/** Turn whatever a user typed ("Acme.com", "https://www.acme.com/about") into a bare domain, or null. */
export function domainFromInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = normalizeUrl(withScheme);
  if (!url) return null;
  const host = cleanHost(url.hostname).replace(/^www\./, "");
  if (!host || (!host.includes(".") && !isIpLiteral(host) && host !== "localhost")) return null;
  return url.port ? `${host}:${url.port}` : host;
}

/** Seed URL for a domain or URL input: keeps an explicit scheme and path, defaults to https. */
export function seedUrlFrom(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalizeUrl(withScheme);
}

export function looksBinary(url: URL): boolean {
  return BINARY_EXTENSIONS.test(url.pathname);
}

const KEY_PAGES: Array<[RegExp, number]> = [
  [/^\/?$/, 100],
  [/^\/(?:about|about-us|company|who-we-are)\/?$/, 90],
  [/^\/(?:team|our-team|people|leadership|management|founders)\/?$/, 88],
  [/^\/(?:contact|contact-us)\/?$/, 85],
  [/^\/(?:careers|jobs|join-us|work-with-us|hiring)\/?$/, 80],
  [/^\/(?:press|news|newsroom|media)\/?$/, 70],
  [/^\/(?:about|company)\/[a-z0-9-]+\/?$/, 60],
  [/^\/(?:customers|partners|pricing|product|products|solutions)\/?$/, 40],
];

/** Higher scores are fetched first. Likely-useful company pages beat everything else. */
export function pagePriority(url: URL): number {
  const path = url.pathname.toLowerCase().replace(/\/index\.html?$/, "/");
  for (const [pattern, score] of KEY_PAGES) if (pattern.test(path)) return url.search ? score - 20 : score;
  const depth = path.split("/").filter(Boolean).length;
  return Math.max(1, 30 - depth * 5 - (url.search ? 10 : 0));
}

export function isCareersPath(url: URL): boolean {
  return /\/(?:careers|jobs|join-us|work-with-us|hiring|open-positions|vacancies)(?:\/|$)/i.test(url.pathname);
}

export function isTeamPath(url: URL): boolean {
  return /\/(?:team|our-team|people|leadership|management|founders|about|about-us|company|who-we-are)(?:\/|$)/i.test(
    url.pathname,
  );
}
