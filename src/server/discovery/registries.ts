/**
 * Official public registries as discovery sources: UK Companies House and US SEC EDGAR. Pure:
 * endpoints, licences, readiness checks, parsers for the registries' JSON and XML, name and role
 * normalisation, and the Wikidata queries that map registry ids to official websites. The fetching
 * and the index writes live in registry-run.ts and registry-store.ts.
 *
 * Only what identifies a company and its current officers is read. Officers' dates of birth,
 * nationality, addresses, occupation and country of residence are never parsed into anything we
 * keep.
 */

export const COMPANIES_HOUSE_API = "https://api.company-information.service.gov.uk";
/** The public page for a company, linked from every record (provenance). */
export const COMPANIES_HOUSE_SITE = "https://find-and-update.company-information.service.gov.uk";
export const COMPANIES_HOUSE_LICENSE = "OGL-UK-3.0";

export const SEC_WWW = "https://www.sec.gov";
export const SEC_DATA = "https://data.sec.gov";
export const SEC_LICENSE = "public-domain";

/** Companies House allows 600 requests per 5 minutes; we stay at one a second. */
export const COMPANIES_HOUSE_PAUSE_MS = 1_000;
/** SEC asks for at most 10 requests a second; we stay at five. */
export const SEC_PAUSE_MS = 200;

export type RegistryKind = "companies_house" | "sec_edgar";

/* -------------------------------------------------------------------------- */
/* Readiness: API key and User-Agent                                          */
/* -------------------------------------------------------------------------- */

export interface RegistryEnv {
  companiesHouseApiKey?: string | null;
  secUserAgent?: string | null;
  /** CRAWLER_ALLOW_PRIVATE_HOSTS: endpoint overrides (local fixtures) are honoured only then. */
  allowPrivate: boolean;
}

export interface RegistryRequirement {
  envVar: "COMPANIES_HOUSE_API_KEY" | "SEC_USER_AGENT";
  message: string;
}

/** A User-Agent the SEC accepts: some text and a contact email address. */
export function validSecUserAgent(value: string | null | undefined): boolean {
  const v = value?.trim() ?? "";
  return v.length >= 6 && v.length <= 200 && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(v);
}

/**
 * What a registry source still needs before it can run, or null when it is ready. A source pointed
 * at local fixture endpoints (only allowed with CRAWLER_ALLOW_PRIVATE_HOSTS) needs neither.
 */
export function registryRequirement(
  kind: RegistryKind,
  env: RegistryEnv,
  overridden = false,
): RegistryRequirement | null {
  if (overridden && env.allowPrivate) return null;
  if (kind === "companies_house") {
    return env.companiesHouseApiKey?.trim()
      ? null
      : {
          envVar: "COMPANIES_HOUSE_API_KEY",
          message:
            "API key missing. Set COMPANIES_HOUSE_API_KEY (a free key from developer.company-information.service.gov.uk) and restart.",
        };
  }
  return validSecUserAgent(env.secUserAgent)
    ? null
    : {
        envVar: "SEC_USER_AGENT",
        message:
          'User-Agent not set. The SEC requires one with a contact email: set SEC_USER_AGENT (e.g. "AnhourLeads admin@example.com") and restart.',
      };
}

/** HTTP basic auth for Companies House: the key is the username, the password is empty. */
export function companiesHouseAuth(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString("base64")}`;
}

/* -------------------------------------------------------------------------- */
/* Registry ids                                                               */
/* -------------------------------------------------------------------------- */

/** Companies House numbers are 8 characters: digits padded with zeros, or a prefix and digits (SC123456). */
export function normalizeCompanyNumber(value: string | number | null | undefined): string | null {
  const v = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/^\d{1,8}$/.test(v)) return v.padStart(8, "0");
  if (/^[A-Z]{2}\d{6}$/.test(v)) return v;
  return null;
}

/** SEC central index keys, stored without leading zeros ("0000320193" → "320193"). */
export function normalizeCik(value: string | number | null | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!/^\d{1,10}$/.test(v)) return null;
  const n = v.replace(/^0+/, "");
  return n || null;
}

export const paddedCik = (cik: string) => cik.padStart(10, "0");

/* -------------------------------------------------------------------------- */
/* Names                                                                      */
/* -------------------------------------------------------------------------- */

const PARTICLES = new Set([
  "van",
  "von",
  "der",
  "den",
  "de",
  "da",
  "del",
  "della",
  "di",
  "du",
  "la",
  "le",
  "dos",
  "das",
]);
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady", "prof", "professor"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

function capitalise(part: string): string {
  if (!part) return part;
  const lower = part.toLowerCase();
  // McDonald, MacLeod (only for longer Mac names, so "Mack" and "Mace" stay as they are).
  const mc = lower.match(/^(mc)(\p{L})(.*)$/u);
  if (mc) return `Mc${(mc[2] ?? "").toUpperCase()}${mc[3] ?? ""}`;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "O'BRIEN-SMITH" → "O'Brien-Smith"; words already in mixed case are kept. */
function properWord(word: string, index: number): string {
  if (word !== word.toUpperCase() || !/\p{L}/u.test(word)) return word;
  const lower = word.toLowerCase();
  if (index > 0 && PARTICLES.has(lower)) return lower;
  if (SUFFIXES.has(lower.replace(/\.$/, ""))) return lower === "jr" || lower === "sr" ? `${capitalise(lower)}.` : word;
  return word
    .split(/([-'’])/)
    .map((p) => (/^[-'’]$/.test(p) ? p : capitalise(p)))
    .join("");
}

function cleanTokens(text: string): string[] {
  return text
    .replace(/[.,]+$/g, "")
    .split(/\s+/)
    .map((t) => t.replace(/,$/, ""))
    .filter((t) => t && !HONORIFICS.has(t.toLowerCase().replace(/\.$/, "")));
}

function assemble(forenames: string[], surname: string[]): string {
  const suffix =
    surname.length > 1 && SUFFIXES.has((surname.at(-1) ?? "").toLowerCase().replace(/\.$/, ""))
      ? surname.slice(-1)
      : [];
  const last = suffix.length ? surname.slice(0, -1) : surname;
  const words = [...forenames, ...last, ...suffix];
  return words
    .map((w, i) => properWord(w, i))
    .join(" ")
    .trim();
}

/**
 * Companies House officer names: "SMITH, John Michael" → "John Michael Smith",
 * "VAN DER BERG, Anna" → "Anna van der Berg", "O'BRIEN, Dr Siobhan" → "Siobhan O'Brien".
 */
export function companiesHouseName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return null;
  const comma = v.indexOf(",");
  if (comma < 0) {
    const tokens = cleanTokens(v);
    return tokens.length ? assemble(tokens, []) : null;
  }
  const surname = cleanTokens(v.slice(0, comma));
  const forenames = cleanTokens(v.slice(comma + 1));
  if (!surname.length) return null;
  const name = assemble(forenames, surname);
  return name.length >= 2 && name.length <= 160 ? name : null;
}

/** SEC filer names are "LAST FIRST MIDDLE" (sometimes "Last, First"): "COOK TIMOTHY D" → "Timothy D Cook". */
export function secOwnerName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return null;
  if (v.includes(",")) return companiesHouseName(v);
  const tokens = cleanTokens(v);
  if (tokens.length < 2) return null;
  const [surname, ...rest] = tokens;
  const suffix =
    rest.length > 1 && SUFFIXES.has((rest.at(-1) ?? "").toLowerCase().replace(/\.$/, "")) ? rest.pop() : null;
  const name = assemble(rest, [surname ?? "", ...(suffix ? [suffix] : [])]);
  return name.length >= 2 && name.length <= 160 ? name : null;
}

/** Filer names that are organisations (funds, trusts, holding companies), never people. */
const ENTITY_WORDS =
  /\b(?:inc|llc|l\.?l\.?c|lp|l\.p|llp|ltd|limited|corp|corporation|co|company|trust|fund|funds|partners|partnership|holdings?|capital|group|management|advisors|advisers|bank|plc|n\.v|s\.a|ag|gmbh|foundation|associates|investments?|ventures|securities)\b/i;

export function looksLikeOrganisation(name: string): boolean {
  return ENTITY_WORDS.test(name.replace(/,/g, " "));
}

/** Sentence-ish proper case for an all-capitals company name ("ACME WIDGETS LIMITED" → "Acme Widgets Limited"). */
const KEEP_UPPER = new Set(["PLC", "LLP", "LP", "UK", "CIC", "USA", "US", "LLC", "AG", "SA", "NV", "BV", "AB", "ASA"]);
export function properCompanyName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return null;
  if (v !== v.toUpperCase()) return v.slice(0, 300);
  return v
    .split(" ")
    .map((w) => {
      const bare = w.replace(/[^A-Z]/g, "");
      if (KEEP_UPPER.has(bare) || (bare.length <= 3 && !/[AEIOU]/.test(bare) && bare.length > 1)) return w;
      return w
        .split(/([-'&./()])/)
        .map((p) => capitalise(p))
        .join("");
    })
    .join(" ")
    .slice(0, 300);
}

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "llc",
  "llp",
  "lp",
  "sa",
  "ag",
  "nv",
  "bv",
  "gmbh",
  "the",
]);

/**
 * A company name for exact matching: lower case, "&" → "and", no punctuation, no legal form
 * ("Apple Inc." and "APPLE INC" → "apple"; "The Sage Group plc" → "sage group").
 */
export function matchKeyForCompanyName(raw: string | null | undefined): string | null {
  const words = (raw ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1) ?? "")) words.pop();
  while (words.length > 1 && words[0] === "the") words.shift();
  const key = words.join(" ");
  return key.length >= 2 ? key : null;
}

/* -------------------------------------------------------------------------- */
/* Companies House                                                            */
/* -------------------------------------------------------------------------- */

const CH_ROLES: Record<string, string> = {
  director: "Director",
  secretary: "Company Secretary",
  "nominee-director": "Nominee Director",
  "nominee-secretary": "Nominee Secretary",
  "llp-member": "LLP Member",
  "llp-designated-member": "LLP Designated Member",
  member: "Member",
  "managing-officer": "Managing Officer",
  "judicial-factor": "Judicial Factor",
  "receiver-and-manager": "Receiver and Manager",
  "cic-manager": "CIC Manager",
  "general-partner-in-a-limited-partnership": "General Partner",
  "limited-partner-in-a-limited-partnership": "Limited Partner",
  "person-authorised-to-represent": "Authorised Representative",
  "person-authorised-to-accept": "Authorised to Accept Service",
  "person-authorised-to-represent-and-accept": "Authorised Representative",
};

/** "director" → "Director", "llp-member" → "LLP Member"; unknown roles become readable words. */
export function companiesHouseRoleTitle(role: string | null | undefined): string | null {
  const r = (role ?? "").trim().toLowerCase();
  if (!r) return null;
  const known = CH_ROLES[r];
  if (known) return known;
  const words = r.split(/[-_\s]+/).filter(Boolean);
  if (!words.length) return null;
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

export interface RegistryOfficer {
  fullName: string;
  title: string | null;
}

interface ChOfficerItem {
  name?: unknown;
  officer_role?: unknown;
  resigned_on?: unknown;
  identification?: unknown;
}

/**
 * Current officers from a Companies House officers response: people only (corporate officers are
 * companies), never anyone with `resigned_on`. Only the name and the role are kept: the response's
 * date of birth, nationality, addresses, occupation and country of residence are dropped here.
 */
export function parseCompaniesHouseOfficers(raw: string): {
  officers: RegistryOfficer[];
  total: number;
  items: number;
} {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { officers: [], total: 0, items: 0 };
  }
  const obj = (body ?? {}) as { items?: unknown; total_results?: unknown };
  const items = Array.isArray(obj.items) ? (obj.items as ChOfficerItem[]) : [];
  const officers: RegistryOfficer[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.resigned_on) continue;
    const role = typeof item.officer_role === "string" ? item.officer_role : "";
    if (role.startsWith("corporate-") || item.identification) continue;
    const fullName = companiesHouseName(typeof item.name === "string" ? item.name : null);
    if (!fullName || looksLikeOrganisation(fullName)) continue;
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    officers.push({ fullName, title: companiesHouseRoleTitle(role) });
  }
  const total = typeof obj.total_results === "number" ? obj.total_results : items.length;
  return { officers, total, items: items.length };
}

export interface CompaniesHouseProfile {
  number: string;
  name: string | null;
  active: boolean;
  foundedYear: number | null;
  city: string | null;
  region: string | null;
  country: string;
}

const UK_NATIONS = new Set(["england", "scotland", "wales", "northern ireland", "england and wales"]);

/** The company's own registered facts (its registered office is a company address, not a person's). */
export function parseCompaniesHouseProfile(raw: string): CompaniesHouseProfile | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const number = normalizeCompanyNumber(typeof body.company_number === "string" ? body.company_number : null);
  if (!number) return null;
  const office = (body.registered_office_address ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  const created = str(body.date_of_creation)?.match(/^(\d{4})/)?.[1];
  const nation = str(office.country);
  const region = str(office.region) ?? (nation && UK_NATIONS.has(nation.toLowerCase()) ? nation : null);
  return {
    number,
    name: properCompanyName(str(body.company_name)),
    active: str(body.company_status)?.toLowerCase() === "active",
    foundedYear: created ? Number(created) : null,
    city: properCompanyName(str(office.locality)),
    region,
    country: "United Kingdom",
  };
}

export interface CompaniesHouseSearchItem {
  number: string;
  name: string | null;
  active: boolean;
}

/** Items from the advanced company search (used when the source lists SIC codes). */
export function parseCompaniesHouseSearch(raw: string): { items: CompaniesHouseSearchItem[]; hits: number } {
  let body: { items?: unknown; hits?: unknown };
  try {
    body = JSON.parse(raw) as { items?: unknown; hits?: unknown };
  } catch {
    return { items: [], hits: 0 };
  }
  const list = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  const items = list.flatMap((i) => {
    const number = normalizeCompanyNumber(typeof i.company_number === "string" ? i.company_number : null);
    if (!number) return [];
    return [
      {
        number,
        name: properCompanyName(typeof i.company_name === "string" ? i.company_name : null),
        active: String(i.company_status ?? "").toLowerCase() === "active",
      },
    ];
  });
  return { items, hits: typeof body.hits === "number" ? body.hits : items.length };
}

export const companiesHousePage = (number: string) => `${COMPANIES_HOUSE_SITE}/company/${number}`;
export const companiesHouseOfficersPage = (number: string) => `${COMPANIES_HOUSE_SITE}/company/${number}/officers`;

/* -------------------------------------------------------------------------- */
/* SEC EDGAR                                                                  */
/* -------------------------------------------------------------------------- */

export interface SecTicker {
  cik: string;
  name: string | null;
  ticker: string | null;
}

/** company_tickers.json → one row per CIK, in the file's order (largest companies first). */
export function parseSecTickers(raw: string): SecTicker[] {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!body || typeof body !== "object") return [];
  const out: SecTicker[] = [];
  const seen = new Set<string>();
  const entries = Object.entries(body as Record<string, unknown>).sort(([a], [b]) => Number(a) - Number(b));
  for (const [, value] of entries) {
    const v = (value ?? {}) as { cik_str?: unknown; ticker?: unknown; title?: unknown };
    const cik = normalizeCik(typeof v.cik_str === "number" || typeof v.cik_str === "string" ? v.cik_str : null);
    if (!cik || seen.has(cik)) continue;
    seen.add(cik);
    out.push({
      cik,
      name: typeof v.title === "string" ? v.title.trim().slice(0, 300) : null,
      ticker: typeof v.ticker === "string" ? v.ticker : null,
    });
  }
  return out;
}

const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  PR: "Puerto Rico",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

export interface SecFiling {
  accession: string;
  filedAt: string;
  form: string;
  /** The raw XML document (the XSL-rendered path prefix removed). */
  document: string;
}

export interface SecSubmissions {
  cik: string;
  name: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  ownershipFilings: SecFiling[];
}

const OWNERSHIP_FORMS = new Set(["3", "4", "3/A", "4/A"]);

/**
 * The company's submissions file: name, website (when it gave one), industry (SIC description),
 * business address city / state / country, and its ownership filings (Forms 3 and 4) filed on or
 * after `since` (YYYY-MM-DD), newest first.
 */
export function parseSecSubmissions(raw: string, since: string): SecSubmissions | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const cik = normalizeCik(typeof body.cik === "string" || typeof body.cik === "number" ? body.cik : null);
  if (!cik) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const addresses = (body.addresses ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const business = addresses.business ?? addresses.mailing ?? {};
  const code = str(business.stateOrCountry)?.toUpperCase() ?? null;
  const usState = code ? US_STATES[code] : undefined;
  const foreign = str(business.country) ?? (!usState ? str(business.stateOrCountryDescription) : null);
  let website = str(body.website);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const recent = ((body.filings as Record<string, unknown> | undefined)?.recent ?? {}) as Record<string, unknown>;
  const col = (k: string) => (Array.isArray(recent[k]) ? (recent[k] as unknown[]) : []);
  const accession = col("accessionNumber");
  const filed = col("filingDate");
  const form = col("form");
  const doc = col("primaryDocument");
  const filings: SecFiling[] = [];
  for (let i = 0; i < accession.length; i++) {
    const f = String(form[i] ?? "");
    const at = String(filed[i] ?? "");
    const a = String(accession[i] ?? "");
    const d = String(doc[i] ?? "");
    if (!OWNERSHIP_FORMS.has(f) || at < since || !/^\d{10}-\d{2}-\d{6}$/.test(a) || !d.toLowerCase().endsWith(".xml")) {
      continue;
    }
    filings.push({ accession: a, filedAt: at, form: f, document: d.replace(/^xsl[^/]*\//i, "") });
  }
  filings.sort((x, y) => y.filedAt.localeCompare(x.filedAt));
  return {
    cik,
    name: str(body.name),
    website,
    industry: str(body.sicDescription),
    city: properCompanyName(str(business.city)),
    region: usState ?? null,
    country: usState ? "United States" : foreign,
    ownershipFilings: filings,
  };
}

const accessionPath = (cik: string, accession: string) => `/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;

/** The filing's public index page (provenance for the people it names). */
export function secFilingIndexUrl(base: string, cik: string, accession: string): string {
  return `${base.replace(/\/+$/, "")}${accessionPath(cik, accession)}/${accession}-index.htm`;
}

export function secFilingDocumentUrl(base: string, cik: string, filing: SecFiling): string {
  return `${base.replace(/\/+$/, "")}${accessionPath(cik, filing.accession)}/${filing.document}`;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function xmlText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>\\s*(?:<value>)?([\\s\\S]*?)(?:</value>)?\\s*</${tag}>`, "i"));
  if (!m?.[1]) return null;
  const v = m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e] ?? "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .trim();
  return v || null;
}
const truthy = (v: string | null) => v === "1" || v?.toLowerCase() === "true";

const OFFICER_ACRONYMS = new Set([
  "CEO",
  "CFO",
  "COO",
  "CTO",
  "CIO",
  "CMO",
  "CAO",
  "CLO",
  "CRO",
  "CPO",
  "CHRO",
  "CISO",
  "EVP",
  "SVP",
  "VP",
  "GC",
  "US",
  "IR",
  "HR",
  "IT",
  "R&D",
  "AI",
  "CCO",
  "CSO",
  "PAO",
  "PFO",
]);

/** Officer titles as filed; only all-capitals titles are re-cased ("EVP, CHIEF FINANCIAL OFFICER" → "EVP, Chief Financial Officer"). */
export function secOfficerTitle(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  // "See Remarks" / "See footnote 1": the role is described elsewhere in the filing.
  if (!v || /^see\b/i.test(v)) return null;
  if (v !== v.toUpperCase() || v.length <= 4) return v;
  const small = new Set(["and", "of", "the", "for", "to", "in", "&"]);
  return v
    .split(" ")
    .map((w, i) => {
      const bare = w.replace(/[^A-Z&]/g, "");
      if (OFFICER_ACRONYMS.has(bare)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower.replace(/[^a-z&]/g, ""))) return lower;
      return w
        .split(/([-/,()])/)
        .map((p) => capitalise(p))
        .join("");
    })
    .join(" ");
}

/**
 * Reporting owners of an ownership filing (Form 3 or 4) who are officers or directors of the
 * issuer: their name and role only (the owner's address in the filing is never read).
 */
export function parseOwnershipDocument(xml: string): RegistryOfficer[] {
  const out: RegistryOfficer[] = [];
  for (const m of xml.matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/gi)) {
    const block = m[1] ?? "";
    const rel = block.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/i)?.[1] ?? "";
    const isOfficer = truthy(xmlText(rel, "isOfficer"));
    const isDirector = truthy(xmlText(rel, "isDirector"));
    if (!isOfficer && !isDirector) continue;
    const rawName = xmlText(block, "rptOwnerName");
    if (!rawName || looksLikeOrganisation(rawName)) continue;
    const fullName = secOwnerName(rawName);
    if (!fullName) continue;
    const officerTitle = isOfficer ? secOfficerTitle(xmlText(rel, "officerTitle")) : null;
    out.push({ fullName, title: officerTitle ?? (isDirector ? "Director" : "Officer") });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Wikidata: registry id → official website                                   */
/* -------------------------------------------------------------------------- */

/** P2622 Companies House ID, P5531 SEC central index key. */
export const REGISTRY_PROPERTY: Record<RegistryKind, string> = { companies_house: "P2622", sec_edgar: "P5531" };

/**
 * One page of registry ids with an official website (P856). Items are picked in a subquery
 * (LIMIT/OFFSET over distinct items, no ORDER BY: both keep the query fast on the public endpoint).
 */
export function buildRegistryWebsiteQuery(kind: RegistryKind, limit: number, offset: number): string {
  const p = REGISTRY_PROPERTY[kind];
  return [
    "SELECT ?item ?id ?website ?itemLabel WHERE {",
    "  {",
    "    SELECT DISTINCT ?item WHERE {",
    `      ?item wdt:${p} [] ; wdt:P856 [] .`,
    "    }",
    `    LIMIT ${Math.max(1, Math.min(5000, Math.floor(limit)))}`,
    `    OFFSET ${Math.max(0, Math.floor(offset))}`,
    "  }",
    `  ?item wdt:${p} ?id ; wdt:P856 ?website .`,
    '  OPTIONAL { ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en") }',
    "}",
  ].join("\n");
}

export interface RegistryWebsite {
  id: string;
  qid: string;
  website: string;
  label: string | null;
}

type Binding = Partial<Record<string, { value?: string }>>;

/**
 * SPARQL results → registry id → website. An item with several websites keeps its first https
 * one; ids are normalised (CH numbers padded to 8, CIKs without leading zeros).
 */
export function parseRegistryWebsites(kind: RegistryKind, raw: string): { rows: RegistryWebsite[]; items: number } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { rows: [], items: 0 };
  }
  const bindings = (body as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  if (!Array.isArray(bindings)) return { rows: [], items: 0 };
  const items = new Set<string>();
  const byId = new Map<string, RegistryWebsite>();
  for (const b of bindings as Binding[]) {
    const qid = b.item?.value?.split("/").pop() ?? "";
    if (!/^Q\d+$/.test(qid)) continue;
    items.add(qid);
    const id = kind === "companies_house" ? normalizeCompanyNumber(b.id?.value) : normalizeCik(b.id?.value);
    const website = b.website?.value?.trim() ?? "";
    if (!id || !/^https?:\/\//i.test(website)) continue;
    const labelValue = b.itemLabel?.value?.trim();
    const label = labelValue && !/^Q\d+$/.test(labelValue) ? labelValue.slice(0, 300) : null;
    const existing = byId.get(id);
    if (!existing) byId.set(id, { id, qid, website, label });
    else if (!existing.website.startsWith("https://") && website.startsWith("https://")) existing.website = website;
  }
  return { rows: [...byId.values()], items: items.size };
}
