/**
 * Dependency-free extraction from HTML. Regex based and deliberately conservative: a missed fact is
 * better than an invented one. Never executes scripts; JSON-LD is parsed as data only.
 */

import { technologiesFrom } from "./technologies";
import type {
  Fact,
  FoundEmail,
  FoundPerson,
  FoundPhone,
  FoundSocial,
  HiringSignal,
  PageExtract,
  SocialNetwork,
} from "./types";
import { isCareersPath, isTeamPath, normalizeUrl } from "./url";

/* -------------------------------------------------------------------------- */
/* Low-level helpers                                                          */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Partial<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  commat: "@",
  period: ".",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Drop comments and non-visible elements. */
function stripInvisible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

/** Visible text of an HTML fragment, entities decoded and whitespace collapsed. */
export function visibleText(html: string): string {
  return collapse(
    decodeEntities(
      stripInvisible(html)
        .replace(/<(br|p|div|li|h[1-6]|tr|td|th|section|article|footer|header)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Parse the attributes of one start tag. Names are lowercased; values are entity-decoded. */
export type Attributes = Partial<Record<string, string>>;

export function parseAttributes(tag: string): Attributes {
  const attrs: Attributes = {};
  const inner = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
  const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of inner.matchAll(re)) {
    const name = m[1]?.toLowerCase();
    if (!name) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Every start tag with this name, as attribute maps. */
export function findTags(html: string, name: string): Attributes[] {
  const out: Attributes[] = [];
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  for (const m of html.matchAll(re)) out.push(parseAttributes(m[0]));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

export function extractTitle(html: string): string | null {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = m?.[1] ? collapse(decodeEntities(m[1].replace(/<[^>]+>/g, ""))) : "";
  return title ? title.slice(0, 300) : null;
}

export function extractMeta(html: string): Partial<Record<string, string>> {
  const meta: Partial<Record<string, string>> = {};
  for (const attrs of findTags(html, "meta")) {
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    const content = attrs.content;
    if (key && content && !(key in meta)) meta[key] = collapse(content).slice(0, 1000);
  }
  return meta;
}

/* -------------------------------------------------------------------------- */
/* Links                                                                      */
/* -------------------------------------------------------------------------- */

export interface Anchor {
  href: string;
  text: string;
}

/** Anchors with absolute http(s) URLs (mailto:/tel: are returned raw for the email/phone extractors). */
export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const m of stripInvisible(html).matchAll(re)) {
    const attrs = parseAttributes(`<a ${m[1] ?? ""}>`);
    const raw = attrs.href?.trim();
    if (!raw) continue;
    const text = collapse(decodeEntities((m[2] ?? "").replace(/<[^>]+>/g, " "))).slice(0, 200);
    if (/^(mailto|tel):/i.test(raw)) {
      out.push({ href: raw, text });
      continue;
    }
    const url = normalizeUrl(raw, baseUrl);
    if (url) out.push({ href: url.toString(), text });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Emails                                                                     */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;
const ASSET_TLDS = /\.(?:png|jpe?g|gif|webp|svg|avif|css|js|ico|bmp|tiff?|woff2?)$/i;
const PLACEHOLDER_DOMAINS =
  /(?:^|\.)(?:example\.(?:com|org|net)|domain\.com|email\.com|yourcompany\.com|company\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com)$/i;

export function cleanEmail(raw: string): string | null {
  const email = raw
    .trim()
    .replace(/^mailto:/i, "")
    .split("?")[0]
    ?.trim()
    .toLowerCase()
    .replace(/[.,;:]+$/, "");
  if (!email || email.length > 254) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1);
  if (ASSET_TLDS.test(email) || PLACEHOLDER_DOMAINS.test(domain)) return null;
  if (!new RegExp(`^${EMAIL_RE.source}$`, "i").test(email)) return null;
  return email;
}

/** Undo common human obfuscation: "jane [at] acme [dot] com", "jane(at)acme.com", "jane at acme dot com". */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi, ".")
    .replace(
      /\b([a-z0-9._%+-]+)\s+(?:at|AT)\s+([a-z0-9-]+(?:\s+(?:dot|DOT)\s+[a-z0-9-]+)+)\b/g,
      (_m, local: string, rest: string) => {
        return `${local}@${rest.replace(/\s+(?:dot|DOT)\s+/g, ".")}`;
      },
    );
}

/** Cloudflare "email protection" encodes addresses as hex XOR'd with the first byte. */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function extractEmails(html: string, anchors: Anchor[], sourceUrl: string): FoundEmail[] {
  const found = new Map<string, FoundEmail>();
  const add = (raw: string, method: FoundEmail["method"]) => {
    const email = cleanEmail(raw);
    if (email && !found.has(email)) found.set(email, { email, sourceUrl, method });
  };
  for (const a of anchors)
    if (/^mailto:/i.test(a.href)) add(decodeURIComponent(a.href.replace(/^mailto:/i, "")), "mailto");
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const decoded = decodeCloudflareEmail(m[1] ?? "");
    if (decoded) add(decoded, "cloudflare");
  }
  const text = visibleText(html);
  for (const m of text.matchAll(EMAIL_RE)) add(m[0], "text");
  const plain = deobfuscate(text);
  if (plain !== text) for (const m of plain.matchAll(EMAIL_RE)) add(m[0], "obfuscated");
  return [...found.values()].slice(0, 50);
}

/* -------------------------------------------------------------------------- */
/* Phones                                                                     */
/* -------------------------------------------------------------------------- */

export function normalizePhone(raw: string): string | null {
  const trimmed = decodeURIComponent(raw.replace(/^tel:/i, "")).trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const cleaned = collapse(trimmed.replace(/[^\d+()\s.-]/g, ""));
  return cleaned.startsWith("+") ? cleaned : cleaned || null;
}

export function extractPhones(html: string, anchors: Anchor[], sourceUrl: string): FoundPhone[] {
  const found = new Map<string, FoundPhone>();
  const add = (raw: string, method: FoundPhone["method"]) => {
    const value = normalizePhone(raw);
    if (!value) return;
    const key = value.replace(/\D/g, "");
    if (!found.has(key)) found.set(key, { value, sourceUrl, method });
  };
  for (const a of anchors) if (/^tel:/i.test(a.href)) add(a.href, "tel");
  // Visible numbers only when written in international form, to avoid matching ids and dates.
  for (const m of visibleText(html).matchAll(/\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/g))
    add(m[0], "text");
  return [...found.values()].slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Social profiles                                                            */
/* -------------------------------------------------------------------------- */

const TWITTER_RESERVED = new Set(["share", "intent", "home", "hashtag", "search", "i", "login", "signup", "explore"]);
const GITHUB_RESERVED = new Set(["features", "login", "join", "about", "pricing", "marketplace", "sponsors", "topics"]);
const FACEBOOK_RESERVED = new Set([
  "sharer",
  "sharer.php",
  "share.php",
  "dialog",
  "plugins",
  "tr",
  "login.php",
  "groups",
]);

/** Company-level social profile for a URL, or null (people profiles, share links and posts don't count). */
export function socialProfile(href: string): { network: SocialNetwork; url: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.|[a-z]{2}\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0]?.toLowerCase();
  if (host === "linkedin.com" && (first === "company" || first === "school") && parts[1]) {
    return { network: "linkedin", url: `https://www.linkedin.com/${first}/${parts[1].toLowerCase()}` };
  }
  if ((host === "twitter.com" || host === "x.com") && first && parts.length === 1 && !TWITTER_RESERVED.has(first)) {
    if (!/^[a-z0-9_]{1,15}$/i.test(parts[0] ?? "")) return null;
    return { network: "twitter", url: `https://x.com/${parts[0]}` };
  }
  if (host === "github.com" && first && parts.length === 1 && !GITHUB_RESERVED.has(first)) {
    return { network: "github", url: `https://github.com/${parts[0]}` };
  }
  if (host === "facebook.com" && first && !FACEBOOK_RESERVED.has(first) && parts.length <= 2) {
    if (first === "pages" || first === "profile.php") return null;
    return { network: "facebook", url: `https://www.facebook.com/${parts[0]}` };
  }
  return null;
}

export function personLinkedin(href: string): string | null {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^(?:www\.|[a-z]{2}\.)/, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "linkedin.com" && parts[0] === "in" && parts[1]) return `https://www.linkedin.com/in/${parts[1]}`;
  } catch {
    // Not a URL.
  }
  return null;
}

export function extractSocial(anchors: Anchor[], extra: string[], sourceUrl: string): FoundSocial[] {
  const found = new Map<string, FoundSocial>();
  for (const href of [...anchors.map((a) => a.href), ...extra]) {
    const profile = socialProfile(href);
    if (profile && !found.has(profile.url)) found.set(profile.url, { ...profile, sourceUrl });
  }
  return [...found.values()];
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

const NAME_SUFFIXES = /^(?:jr|sr|ii|iii|iv|phd|md|mba|cpa|esq)\.?$/i;
const TITLE_WORDS =
  /\b(?:ceo|cto|cfo|coo|cmo|cio|cpo|cro|chief|founder|co-founder|cofounder|president|vp|vice president|head|director|manager|lead|engineer|developer|designer|officer|partner|principal|owner|chair|chairman|chairwoman|board|advisor|head of|marketing|sales|operations|product|counsel|architect|scientist|analyst|consultant|recruiter|specialist|coordinator|executive|associate|editor|founding)\b/i;

/** Split a display name into first and last. Returns null when it doesn't look like a person's name. */
export function splitName(raw: string): { name: string; firstName: string; lastName: string } | null {
  const name = collapse(raw.replace(/[,|·•–—].*$/, ""));
  if (name.length < 3 || name.length > 60 || /\d|@|https?:/i.test(name)) return null;
  const words = name.split(" ").filter((w) => !NAME_SUFFIXES.test(w.replace(/,$/, "")));
  if (words.length < 2 || words.length > 4) return null;
  if (!words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w))) return null;
  if (TITLE_WORDS.test(name)) return null;
  return { name, firstName: words[0] ?? "", lastName: words[words.length - 1] ?? "" };
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typesOf(obj: JsonObject): string[] {
  const t = obj["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase());
}

function str(v: Json | undefined): string | null {
  if (typeof v === "string") return collapse(decodeEntities(v)) || null;
  if (typeof v === "number") return String(v);
  if (isObject(v) && typeof v.name === "string") return collapse(v.name) || null;
  return null;
}

function strings(v: Json | undefined): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" ? [x] : []));
  return typeof v === "string" ? [v] : [];
}

/** Every JSON-LD object in the page, flattened (including @graph members and nested values). */
export function jsonLdObjects(html: string): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (value: Json, depth: number) => {
    if (depth > 8 || out.length > 500) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    out.push(value);
    for (const v of Object.values(value)) if (typeof v === "object" && v !== null) walk(v, depth + 1);
  };
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    try {
      walk(JSON.parse((m[1] ?? "").trim()) as Json, 0);
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return out;
}

function personFromJsonLd(obj: JsonObject, sourceUrl: string): FoundPerson | null {
  const parts = splitName(str(obj.name) ?? [str(obj.givenName), str(obj.familyName)].filter(Boolean).join(" "));
  if (!parts) return null;
  const sameAs = strings(obj.sameAs);
  const linkedin =
    sameAs.map(personLinkedin).find(Boolean) ?? (str(obj.url) ? personLinkedin(str(obj.url) ?? "") : null);
  const email = str(obj.email) ? cleanEmail(str(obj.email) ?? "") : null;
  return {
    ...parts,
    title: str(obj.jobTitle)?.slice(0, 120) ?? null,
    sourceUrl,
    method: "json_ld",
    confidence: 0.85,
    linkedinUrl: linkedin ?? null,
    email,
  };
}

function microdataPeople(html: string, sourceUrl: string): FoundPerson[] {
  const out: FoundPerson[] = [];
  const marker = /itemtype\s*=\s*["']https?:\/\/schema\.org\/Person["']/gi;
  const starts = [...html.matchAll(marker)].map((m) => m.index ?? 0);
  starts.forEach((start, i) => {
    const chunk = html.slice(start, starts[i + 1] ?? start + 3000);
    const prop = (name: string) => {
      const meta = chunk.match(new RegExp(`<meta\\b[^>]*itemprop=["']${name}["'][^>]*>`, "i"));
      if (meta) return parseAttributes(meta[0]).content ?? null;
      const el = chunk.match(new RegExp(`<(\\w+)\\b[^>]*itemprop=["']${name}["'][^>]*>([\\s\\S]*?)</\\1>`, "i"));
      return el?.[2] ? collapse(decodeEntities(el[2].replace(/<[^>]+>/g, " "))) : null;
    };
    const parts = splitName(prop("name") ?? "");
    if (!parts) return;
    out.push({
      ...parts,
      title: prop("jobTitle")?.slice(0, 120) ?? null,
      sourceUrl,
      method: "microdata",
      confidence: 0.8,
      linkedinUrl: null,
      email: null,
    });
  });
  return out;
}

/** Team-card markup: a heading with a name followed closely by an element with a job title. */
function markupPeople(html: string, sourceUrl: string): FoundPerson[] {
  const out: FoundPerson[] = [];
  const clean = stripInvisible(html);
  const re =
    /<(h[2-6]|strong|b)\b[^>]*>([\s\S]{3,80}?)<\/\1\s*>\s*(?:<[^>]+>\s*){0,4}?<(p|span|div|h[3-6]|small|em)\b[^>]*>([\s\S]{2,120}?)<\/\3\s*>/gi;
  for (const m of clean.matchAll(re)) {
    const name = collapse(decodeEntities((m[2] ?? "").replace(/<[^>]+>/g, " ")));
    const title = collapse(decodeEntities((m[4] ?? "").replace(/<[^>]+>/g, " ")));
    const parts = splitName(name);
    if (!parts || !TITLE_WORDS.test(title) || title.length > 100) continue;
    const window = clean.slice(m.index ?? 0, (m.index ?? 0) + (m[0]?.length ?? 0) + 600);
    const linkedin = [...window.matchAll(/href=["']([^"']+)["']/gi)]
      .map((h) => personLinkedin(h[1] ?? ""))
      .find(Boolean);
    out.push({
      ...parts,
      title,
      sourceUrl,
      method: "markup",
      confidence: 0.6,
      linkedinUrl: linkedin ?? null,
      email: null,
    });
  }
  return out;
}

/**
 * Words that never appear in a person's name but often in name-shaped headings on real team and
 * about pages: product names, plans, customer logos ("The HubSpot Customer Platform", "Small
 * Business Bundle", "Open AI").
 */
const NON_NAME_WORDS = new Set(
  (
    "the our your my their and of for with to in on at by from " +
    "platform bundle business customer customers software cloud data suite hub studio labs lab " +
    "inc llc ltd gmbh corp corporation company companies group solutions services service products " +
    "product edition plan plans pricing enterprise starter pro premium free team teams values mission " +
    "careers jobs news blog press events partners investors board leadership management " +
    "support contact about home app apps api security privacy terms policy center centre network " +
    "community foundation capital ventures fund holdings global international digital media studios"
  ).split(" "),
);

/** A second check on top of splitName for people found on pages: no product-ish words, no acronyms. */
export function plausiblePersonName(name: string): boolean {
  const words = name.split(" ");
  if (words.some((w) => NON_NAME_WORDS.has(w.toLowerCase().replace(/[.'’]/g, "")))) return false;
  // "AI", "CEO", "HR": all-caps words of two or more letters are acronyms, not names (initials
  // are written "J." or "J.R.").
  if (words.some((w) => /^\p{Lu}{2,}$/u.test(w))) return false;
  // "Mark H.", "Chris J": review and testimonial signatures, not a full name.
  return !/^\p{Lu}\.?$/u.test(words[words.length - 1] ?? "");
}

/**
 * JSON-LD keys whose Person values are not the company's people: review and testimonial authors,
 * article bylines, commenters.
 */
const NOT_STAFF_KEYS = ["author", "creator", "editor", "contributor", "review", "reviews", "comment", "reviewedBy"];

function notStaff(objects: JsonObject[]): Set<JsonObject> {
  const out = new Set<JsonObject>();
  const walk = (v: Json | undefined, depth: number) => {
    if (depth > 6 || v === null || v === undefined || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    out.add(v);
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const obj of objects) {
    const types = typesOf(obj);
    // Reviews and articles themselves: everyone in them is an author or a subject.
    if (types.some((t) => t === "review" || t.endsWith("article") || t === "blogposting" || t === "comment"))
      for (const key of NOT_STAFF_KEYS.concat("about", "mentions")) walk(obj[key], 0);
    for (const key of NOT_STAFF_KEYS) walk(obj[key], 0);
  }
  return out;
}

export function extractPeople(html: string, objects: JsonObject[], url: URL): FoundPerson[] {
  const sourceUrl = url.toString();
  const people = new Map<string, FoundPerson>();
  const add = (p: FoundPerson | null) => {
    if (!p || !plausiblePersonName(p.name)) return;
    const key = p.name.toLowerCase();
    const existing = people.get(key);
    if (!existing || existing.confidence < p.confidence)
      people.set(key, { ...p, title: p.title ?? existing?.title ?? null });
  };
  const teamPage = isTeamPath(url);
  const excluded = notStaff(objects);
  // Outside team-like pages a person needs a job title to count (a bare name is usually a byline).
  const addStaff = (p: FoundPerson | null) => {
    if (p && (teamPage || p.title)) add(p);
  };
  for (const obj of objects)
    if (typesOf(obj).includes("person") && !excluded.has(obj)) addStaff(personFromJsonLd(obj, sourceUrl));
  for (const p of microdataPeople(html, sourceUrl)) addStaff(p);
  // Card markup only on team-like pages, where a heading + title pair almost always means a person.
  if (teamPage) for (const p of markupPeople(html, sourceUrl)) add(p);
  return [...people.values()].slice(0, 100);
}

/* -------------------------------------------------------------------------- */
/* Company facts and hiring                                                   */
/* -------------------------------------------------------------------------- */

const ATS_HOSTS: Array<[RegExp, string]> = [
  [/(?:^|\.)greenhouse\.io$/, "Greenhouse"],
  [/(?:^|\.)lever\.co$/, "Lever"],
  [/(?:^|\.)ashbyhq\.com$/, "Ashby"],
  [/(?:^|\.)workable\.com$/, "Workable"],
  [/(?:^|\.)recruitee\.com$/, "Recruitee"],
  [/(?:^|\.)bamboohr\.com$/, "BambooHR"],
  [/(?:^|\.)breezy\.hr$/, "Breezy HR"],
  [/(?:^|\.)smartrecruiters\.com$/, "SmartRecruiters"],
  [/(?:^|\.)teamtailor\.com$/, "Teamtailor"],
  [/(?:^|\.)personio\.(?:de|com)$/, "Personio"],
  [/(?:^|\.)myworkdayjobs\.com$/, "Workday"],
  [/(?:^|\.)wellfound\.com$/, "Wellfound"],
];

function orgFacts(objects: JsonObject[], sourceUrl: string): { facts: Fact[]; sameAs: string[]; jobPostings: number } {
  const facts: Fact[] = [];
  const sameAs: string[] = [];
  let jobPostings = 0;
  const fact = (field: Fact["field"], value: string | null | undefined, confidence = 0.85) => {
    if (value) facts.push({ field, value: value.slice(0, 1000), sourceUrl, confidence, method: "json_ld" });
  };
  for (const obj of objects) {
    const types = typesOf(obj);
    if (types.includes("jobposting")) jobPostings += 1;
    if (!types.some((t) => /organization|corporation|localbusiness|company|ngo/.test(t))) continue;
    fact("name", str(obj.legalName) ?? str(obj.name));
    fact("description", str(obj.description), 0.8);
    fact("phone", str(obj.telephone) ? normalizePhone(str(obj.telephone) ?? "") : null, 0.8);
    const founding = str(obj.foundingDate)?.match(/(?:19|20)\d{2}/)?.[0];
    fact("foundedYear", founding);
    const employees = obj.numberOfEmployees;
    const count = isObject(employees) ? (str(employees.value) ?? str(employees.minValue)) : str(employees);
    if (count && /^\d{1,7}$/.test(count)) fact("employeeCount", count, 0.7);
    const logo = str(obj.logo) ?? (isObject(obj.logo) ? str(obj.logo.url) : null);
    if (logo && /^https?:/i.test(logo)) fact("logoUrl", logo, 0.8);
    const address = Array.isArray(obj.address) ? obj.address[0] : obj.address;
    if (isObject(address)) {
      fact("city", str(address.addressLocality), 0.75);
      fact("country", str(address.addressCountry), 0.75);
    }
    sameAs.push(...strings(obj.sameAs));
  }
  return { facts, sameAs, jobPostings };
}

export function extractYears(text: string): { founded: string | null; copyright: string | null } {
  const founded = text.match(/\b(?:founded|established|started|since)\s+(?:in\s+)?((?:19|20)\d{2})\b/i)?.[1] ?? null;
  const copyright = text.match(/(?:©|\(c\)|copyright)\s*(?:\(c\)\s*)?((?:19|20)\d{2})/i)?.[1] ?? null;
  const year = new Date().getUTCFullYear();
  const valid = (y: string | null) => (y && Number(y) >= 1800 && Number(y) <= year ? y : null);
  return { founded: valid(founded), copyright: valid(copyright) };
}

function extractHiring(text: string, anchors: Anchor[], url: URL, jobPostings: number): HiringSignal {
  const careers = isCareersPath(url);
  const ats = new Set<string>();
  const jobLinks = new Set<string>();
  for (const a of anchors) {
    if (!/^https?:/i.test(a.href)) continue;
    const target = new URL(a.href);
    for (const [re, name] of ATS_HOSTS) if (re.test(target.hostname.toLowerCase())) ats.add(name);
    if (careers && /\/(?:careers|jobs|positions|openings)\/[a-z0-9][\w-]+\/?$/i.test(target.pathname)) {
      jobLinks.add(target.pathname);
    }
  }
  const stated = text.match(/\b(\d{1,4})\s+(?:open\s+)?(?:positions|roles|jobs|openings|vacancies|opportunities)\b/i);
  const jobCount = jobPostings || (stated ? Number(stated[1]) : 0) || (careers ? jobLinks.size : 0) || null;
  const mentions: string[] = [];
  if (/we['’]re hiring|we are hiring|join our team|open positions|open roles/i.test(text)) mentions.push("hiring");
  return { careersUrl: careers ? url.toString() : null, jobCount, ats: [...ats], mentions };
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function extractPage(html: string, pageUrl: string, headers: Partial<Record<string, string>> = {}): PageExtract {
  const url = new URL(pageUrl);
  const sourceUrl = url.toString();
  const anchors = extractAnchors(html, sourceUrl);
  const meta = extractMeta(html);
  const title = extractTitle(html);
  const objects = jsonLdObjects(html);
  const text = visibleText(html);
  const org = orgFacts(objects, sourceUrl);

  const facts: Fact[] = [...org.facts];
  const metaFact = (field: Fact["field"], value: string | undefined, confidence: number, method: string) => {
    if (value) facts.push({ field, value, sourceUrl, confidence, method });
  };
  metaFact("title", title ?? undefined, 0.5, "title");
  metaFact("siteName", meta["og:site_name"], 0.75, "og:site_name");
  metaFact("description", meta.description ?? meta["og:description"], 0.6, "meta_description");
  const years = extractYears(text);
  metaFact("foundedYear", years.founded ?? undefined, 0.6, "text");
  metaFact("copyrightYear", years.copyright ?? undefined, 0.5, "copyright");

  const emails = extractEmails(html, anchors, sourceUrl);
  for (const obj of objects) {
    const e = str(obj.email);
    const email = e ? cleanEmail(e) : null;
    if (email && !emails.some((x) => x.email === email)) emails.push({ email, sourceUrl, method: "json_ld" });
  }

  const social = extractSocial(anchors, org.sameAs, sourceUrl);
  for (const s of social) {
    const field = `${s.network}Url` as Fact["field"];
    facts.push({ field, value: s.url, sourceUrl, confidence: 0.8, method: "link" });
  }
  const phones = extractPhones(html, anchors, sourceUrl);

  return {
    title,
    facts,
    emails,
    phones,
    social,
    technologies: technologiesFrom(html, headers, sourceUrl),
    people: extractPeople(html, objects, url),
    hiring: extractHiring(text, anchors, url, org.jobPostings),
    links: anchors.filter((a) => /^https?:/i.test(a.href)).map((a) => ({ url: a.href, text: a.text })),
  };
}
