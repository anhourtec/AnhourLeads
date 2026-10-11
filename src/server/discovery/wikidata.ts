/**
 * Wikidata (CC0) as a seed source: businesses with an official website. Pure: the SPARQL query
 * builder and the result parser. The fetching (one request every 2 s, our user agent) lives in
 * src/server/discovery/seeds.ts.
 */

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
export const WIKIDATA_LICENSE = "CC0-1.0";

/**
 * Item types read: business, company, enterprise, public company, privately held company,
 * technology company, software company. Direct instances only (`wdt:P31`): following the subclass
 * tree (`wdt:P31/wdt:P279*`) over all of Wikidata times out on the public endpoint (HTTP 504 after
 * 60 s), and so does ORDER BY over the whole set.
 */
const BUSINESS_TYPES = ["Q4830453", "Q783794", "Q6881511", "Q891723", "Q1589009", "Q18388277", "Q1058914"];

const QID = /^Q\d{1,12}$/;

export interface WikidataFilters {
  /** Country item ids (P17), e.g. Q30 (United States), Q16 (Canada). */
  countries?: string[];
  /** Industry item ids (P452), e.g. Q11661 (information technology). */
  industries?: string[];
  /** Only companies with a recorded head count (P1128): fewer, better described rows. */
  requireHeadcount?: boolean;
}

export function isQid(value: string): boolean {
  return QID.test(value);
}

/**
 * One page of the query. Filters are validated item ids, so nothing user-typed reaches SPARQL
 * verbatim. The page of items is chosen in a subquery (LIMIT/OFFSET over distinct items, cheap)
 * and only those items are then described, which keeps each request well under the endpoint's
 * 60 s limit.
 */
export function buildWikidataQuery(filters: WikidataFilters, limit: number, offset: number): string {
  const countries = (filters.countries ?? []).filter(isQid);
  const industries = (filters.industries ?? []).filter(isQid);
  const countryLine = `?item wdt:P17 ?country . VALUES ?country { ${countries.map((q) => `wd:${q}`).join(" ")} }`;
  const industryLine = `?item wdt:P452 ?industry . VALUES ?industry { ${industries.map((q) => `wd:${q}`).join(" ")} }`;
  const inner = [
    `      VALUES ?type { ${BUSINESS_TYPES.map((q) => `wd:${q}`).join(" ")} }`,
    "      ?item wdt:P31 ?type ; wdt:P856 ?website .",
  ];
  if (countries.length) inner.push(`      ${countryLine}`);
  if (industries.length) inner.push(`      ${industryLine}`);
  if (filters.requireHeadcount) inner.push("      ?item wdt:P1128 [] .");
  const lines = [
    "SELECT ?item ?itemLabel ?website ?countryLabel ?industryLabel ?employees ?inception ?hqLabel WHERE {",
    "  {",
    "    SELECT DISTINCT ?item WHERE {",
    ...inner,
    "    }",
    `    LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`,
    `    OFFSET ${Math.max(0, Math.floor(offset))}`,
    "  }",
    "  ?item wdt:P856 ?website .",
    countries.length ? `  ${countryLine}` : "  OPTIONAL { ?item wdt:P17 ?country . }",
    industries.length ? `  ${industryLine}` : "  OPTIONAL { ?item wdt:P452 ?industry . }",
    "  OPTIONAL { ?item wdt:P1128 ?employees . }",
    "  OPTIONAL { ?item wdt:P571 ?inception . }",
    "  OPTIONAL { ?item wdt:P159 ?hq . }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
    "}",
  ];
  return lines.join("\n");
}

/** GET URL for one page (SPARQL protocol, JSON results). */
export function wikidataRequestUrl(endpoint: string, query: string): string {
  const url = new URL(endpoint);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  return url.toString();
}

export interface WikidataCompany {
  qid: string;
  name: string | null;
  website: string;
  country: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  city: string | null;
}

type Binding = Partial<Record<string, { type?: string; value?: string }>>;

function value(b: Binding, key: string): string | null {
  const v = b[key]?.value?.trim();
  return v ? v.slice(0, 300) : null;
}

/** A label that is only the item id ("Q123") means Wikidata had no English label. */
function label(b: Binding, key: string): string | null {
  const v = value(b, key);
  return v && !isQid(v) ? v : null;
}

/**
 * SPARQL JSON results → one row per item (the first website wins; extra rows for the same item
 * fill missing fields). Rows without an http(s) website are dropped.
 */
export function parseWikidataResults(raw: string): { rows: WikidataCompany[]; count: number; items: number } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { rows: [], count: 0, items: 0 };
  }
  const bindings = (body as { results?: { bindings?: unknown } })?.results?.bindings;
  if (!Array.isArray(bindings)) return { rows: [], count: 0, items: 0 };
  const byItem = new Map<string, WikidataCompany>();
  const seen = new Set<string>();
  for (const b of bindings as Binding[]) {
    const qid = value(b, "item")?.split("/").pop() ?? null;
    if (qid) seen.add(qid);
    const website = value(b, "website");
    if (!qid || !isQid(qid) || !website || !/^https?:\/\//i.test(website)) continue;
    const employees = Number(value(b, "employees"));
    const inception = value(b, "inception")?.match(/^[+-]?(\d{4})/)?.[1];
    const row: WikidataCompany = {
      qid,
      name: label(b, "itemLabel"),
      website,
      country: label(b, "countryLabel"),
      industry: label(b, "industryLabel"),
      employeeCount: Number.isFinite(employees) && employees > 0 ? Math.round(employees) : null,
      foundedYear: inception ? Number(inception) : null,
      city: label(b, "hqLabel"),
    };
    const existing = byItem.get(qid);
    if (!existing) byItem.set(qid, row);
    else {
      existing.country ??= row.country;
      existing.industry ??= row.industry;
      // Several head counts (one per year) → the largest, usually the latest.
      if (row.employeeCount && (!existing.employeeCount || row.employeeCount > existing.employeeCount))
        existing.employeeCount = row.employeeCount;
      existing.foundedYear ??= row.foundedYear;
      existing.city ??= row.city;
    }
  }
  return { rows: [...byItem.values()], count: bindings.length, items: seen.size };
}
