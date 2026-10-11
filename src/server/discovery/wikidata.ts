/**
 * Wikidata (CC0) as a seed source: businesses with an official website. Pure: the SPARQL query
 * builder and the result parser. The fetching (one request every 2 s, our user agent) lives in
 * src/server/discovery/seeds.ts.
 */

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
export const WIKIDATA_LICENSE = "CC0-1.0";

/** business, company, enterprise: an item is an instance of one of these or of a subclass. */
const BUSINESS_TYPES = ["Q4830453", "Q783794", "Q6881511"];

const QID = /^Q\d{1,12}$/;

export interface WikidataFilters {
  /** Country item ids (P17), e.g. Q30 (United States), Q16 (Canada). */
  countries?: string[];
  /** Industry item ids (P452), e.g. Q11661 (information technology). */
  industries?: string[];
}

export function isQid(value: string): boolean {
  return QID.test(value);
}

/** One page of the query. Filters are validated item ids, so nothing user-typed reaches SPARQL verbatim. */
export function buildWikidataQuery(filters: WikidataFilters, limit: number, offset: number): string {
  const countries = (filters.countries ?? []).filter(isQid);
  const industries = (filters.industries ?? []).filter(isQid);
  const lines = [
    "SELECT ?item ?itemLabel ?website ?countryLabel ?industryLabel ?employees ?inception ?hqLabel WHERE {",
    `  VALUES ?type { ${BUSINESS_TYPES.map((q) => `wd:${q}`).join(" ")} }`,
    "  ?item wdt:P31/wdt:P279* ?type .",
    "  ?item wdt:P856 ?website .",
  ];
  if (countries.length)
    lines.push(`  ?item wdt:P17 ?country . VALUES ?country { ${countries.map((q) => `wd:${q}`).join(" ")} }`);
  else lines.push("  OPTIONAL { ?item wdt:P17 ?country . }");
  if (industries.length) {
    lines.push(`  ?item wdt:P452 ?industry . VALUES ?industry { ${industries.map((q) => `wd:${q}`).join(" ")} }`);
  } else {
    lines.push("  OPTIONAL { ?item wdt:P452 ?industry . }");
  }
  lines.push(
    "  OPTIONAL { ?item wdt:P1128 ?employees . }",
    "  OPTIONAL { ?item wdt:P571 ?inception . }",
    "  OPTIONAL { ?item wdt:P159 ?hq . }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
    "}",
    "ORDER BY ?item",
    `LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`,
    `OFFSET ${Math.max(0, Math.floor(offset))}`,
  );
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
export function parseWikidataResults(raw: string): { rows: WikidataCompany[]; count: number } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { rows: [], count: 0 };
  }
  const bindings = (body as { results?: { bindings?: unknown } })?.results?.bindings;
  if (!Array.isArray(bindings)) return { rows: [], count: 0 };
  const byItem = new Map<string, WikidataCompany>();
  for (const b of bindings as Binding[]) {
    const qid = value(b, "item")?.split("/").pop() ?? null;
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
      existing.employeeCount ??= row.employeeCount;
      existing.foundedYear ??= row.foundedYear;
      existing.city ??= row.city;
    }
  }
  return { rows: [...byItem.values()], count: bindings.length };
}
