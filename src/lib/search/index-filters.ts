import { SENIORITIES } from "@/lib/records-vocabulary";

import { asArray, CUSTOM_FIELD_PREFIX, EMPLOYEE_RANGE_KEYS, type FilterState, type SearchEntity } from "./filters";

/**
 * Which search filters apply to the installation-wide discovery index (Find people / Find
 * companies → Total and Net new), and how the shared filter state maps onto the index search
 * input (`indexPeopleSearchInput` / `indexCompanySearchInput` in src/server/services/discovery.ts).
 * Safe to import from client components and server code.
 *
 * Filters about the workspace's own records (owner, stage, lists, sequences, engagement, custom
 * fields, imports, email status, personas…) have no meaning in the shared index: the UI shows them
 * disabled on those tabs and they keep working on the Saved tab.
 */

/** Filter catalog ids (records/search/filter-catalog.ts) that work on the index. */
export const INDEX_FILTER_IDS: Record<SearchEntity, ReadonlySet<string>> = {
  contact: new Set([
    "jobTitles",
    "name",
    "location",
    "company",
    "companyLocation",
    "employees",
    "industryKeywords",
    "technologies",
    "founded",
  ]),
  company: new Set(["location", "company", "employees", "industryKeywords", "technologies", "founded"]),
};

/** Shared filter key → index input key. */
const COMMON: Record<string, string> = {
  q: "q",
  location: "location",
  locationExclude: "locationExclude",
  country: "country",
  company: "companies",
  companyExclude: "companiesExclude",
  domains: "domains",
  employeeRanges: "employeeRanges",
  employeesMin: "employeesMin",
  employeesMax: "employeesMax",
  employeesUnknown: "employeesUnknown",
  industry: "industry",
  industryExclude: "industryExclude",
  keywords: "keywords",
  keywordsExclude: "keywordsExclude",
  technologies: "technologies",
  foundedMin: "foundedMin",
  foundedMax: "foundedMax",
};

const PEOPLE: Record<string, string> = {
  ...COMMON,
  name: "name",
  titles: "titles",
  titlesExclude: "titlesExclude",
  seniority: "seniority",
  department: "department",
  companyLocation: "companyLocation",
};

const KEY_MAP: Record<SearchEntity, Record<string, string>> = { contact: PEOPLE, company: COMMON };

const ARRAY_INPUTS = new Set([
  "location",
  "locationExclude",
  "country",
  "companies",
  "companiesExclude",
  "domains",
  "employeeRanges",
  "industry",
  "industryExclude",
  "keywords",
  "keywordsExclude",
  "technologies",
  "titles",
  "titlesExclude",
  "seniority",
  "department",
  "companyLocation",
]);
const NUMBER_INPUTS = new Set(["employeesMin", "employeesMax", "foundedMin", "foundedMax"]);

export const INDEX_SORT_FIELDS: Record<SearchEntity, { value: string; label: string }[]> = {
  contact: [
    { value: "name", label: "Name" },
    { value: "title", label: "Job title" },
    { value: "company", label: "Company" },
    { value: "lastSeenAt", label: "Last seen" },
  ],
  company: [
    { value: "name", label: "Name" },
    { value: "employeeCount", label: "Employees" },
    { value: "foundedYear", label: "Founded" },
    { value: "lastCrawledAt", label: "Last crawled" },
  ],
};

function isActive(value: FilterState[string] | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Active filter keys the index can't apply (shown to the user, never silently dropped). */
export function unsupportedIndexKeys(entity: SearchEntity, filters: FilterState): string[] {
  const map = KEY_MAP[entity];
  return Object.entries(filters)
    .filter(([key, value]) => isActive(value) && key !== "similarTitles" && !(key in map))
    .map(([key]) => key);
}

export function isCustomFieldKey(key: string): boolean {
  return key.startsWith(CUSTOM_FIELD_PREFIX);
}

/**
 * Shared filter state (plus sort) → the index search body. Values the index input would reject
 * (unknown seniorities or size ranges, non-numbers) are dropped so a stale URL never fails the page.
 */
export function indexBodyFromFilters(
  entity: SearchEntity,
  filters: FilterState,
  sort: { sortBy?: string | null; sortAscending?: string | null } = {},
): Record<string, unknown> {
  const map = KEY_MAP[entity];
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    const target = map[key];
    if (!target || !isActive(value)) continue;
    if (ARRAY_INPUTS.has(target)) {
      let list = asArray(value)
        .map((v) => v.trim())
        .filter(Boolean);
      if (target === "seniority") list = list.filter((v) => (SENIORITIES as readonly string[]).includes(v));
      if (target === "employeeRanges") list = list.filter((v) => EMPLOYEE_RANGE_KEYS.includes(v));
      if (list.length) body[target] = list.slice(0, 50);
    } else if (NUMBER_INPUTS.has(target)) {
      const n = Number(asArray(value)[0]);
      if (Number.isInteger(n) && n >= 0 && n <= 10_000_000) body[target] = n;
    } else if (target === "employeesUnknown") {
      if (asArray(value)[0] === "true") body[target] = true;
    } else {
      const text = asArray(value)[0]?.trim();
      if (text) body[target] = text.slice(0, 200);
    }
  }
  // Founded years outside the index's accepted window are dropped rather than failing.
  for (const k of ["foundedMin", "foundedMax"]) {
    const n = body[k];
    if (typeof n === "number" && (n < 1000 || n > 3000)) delete body[k];
  }
  if (sort.sortBy && INDEX_SORT_FIELDS[entity].some((f) => f.value === sort.sortBy)) {
    body.sortBy = sort.sortBy;
    if (sort.sortAscending === "true") body.sortAscending = true;
    if (sort.sortAscending === "false") body.sortAscending = false;
  }
  return body;
}
