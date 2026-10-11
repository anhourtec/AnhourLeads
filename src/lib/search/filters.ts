/**
 * People and company search filters: vocabulary, URL codec and helpers, safe to import from client
 * components, server code and tests. The server validates the same keys in
 * src/server/services/search-filters.ts.
 *
 * Filters travel as URL query parameters (arrays as repeated keys, custom fields as `cf.<key>`) and
 * are stored as the same object in saved searches and dynamic lists.
 */

export type SearchEntity = "contact" | "company";

export const SEGMENTS = ["total", "net_new", "saved"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = { total: "Total", net_new: "Net new", saved: "Saved" };

export interface EmployeeRange {
  key: string;
  min: number;
  max: number | null;
}

export const EMPLOYEE_RANGES: EmployeeRange[] = [
  { key: "1-10", min: 1, max: 10 },
  { key: "11-20", min: 11, max: 20 },
  { key: "21-50", min: 21, max: 50 },
  { key: "51-100", min: 51, max: 100 },
  { key: "101-200", min: 101, max: 200 },
  { key: "201-500", min: 201, max: 500 },
  { key: "501-1000", min: 501, max: 1000 },
  { key: "1001-2000", min: 1001, max: 2000 },
  { key: "2001-5000", min: 2001, max: 5000 },
  { key: "5001-10000", min: 5001, max: 10000 },
  { key: "10001+", min: 10001, max: null },
];
export const EMPLOYEE_RANGE_KEYS = EMPLOYEE_RANGES.map((r) => r.key) as [string, ...string[]];

export const DEPARTMENTS = [
  "C-Suite",
  "Product",
  "Engineering & Technical",
  "Design",
  "Education",
  "Finance",
  "Human Resources",
  "Information Technology",
  "Legal",
  "Marketing",
  "Medical & Health",
  "Operations",
  "Sales",
  "Consulting",
] as const;

export const ENGAGEMENT_FLAGS = [
  "emailSent",
  "emailOpened",
  "emailReplied",
  "emailBounced",
  "emailUnsubscribed",
] as const;
export type EngagementFlag = (typeof ENGAGEMENT_FLAGS)[number];
export const ENGAGEMENT_LABELS: Record<EngagementFlag, string> = {
  emailSent: "Email sent",
  emailOpened: "Email opened",
  emailReplied: "Email replied",
  emailBounced: "Email bounced",
  emailUnsubscribed: "Email unsubscribed",
};

/** Multi-value keys (repeated in the URL). */
export const ARRAY_KEYS = [
  "titles",
  "titlesExclude",
  "seniority",
  "department",
  "personaId",
  "emailStatus",
  "location",
  "locationExclude",
  "country",
  "timezone",
  "company",
  "companyExclude",
  "companyLocation",
  "domains",
  "employeeRanges",
  "industry",
  "industryExclude",
  "keywords",
  "keywordsExclude",
  "technologies",
  "sequenceId",
  "sequenceExclude",
  "source",
  "importId",
  "listId",
  "listExclude",
  "ownerId",
  "stage",
  "tags",
] as const;

/** Single-value keys. */
export const SCALAR_KEYS = [
  "q",
  "name",
  "similarTitles",
  "companyId",
  "employeesMin",
  "employeesMax",
  "employeesUnknown",
  "foundedMin",
  "foundedMax",
  "revenueMin",
  "revenueMax",
  "lastActivityFrom",
  "lastActivityTo",
  "createdFrom",
  "createdTo",
  ...ENGAGEMENT_FLAGS,
] as const;

/** Keys that shape the view rather than filter it. */
export const VIEW_KEYS = ["segment", "sortBy", "sortAscending", "page", "per_page", "savedSearchId"] as const;

export const CUSTOM_FIELD_PREFIX = "cf.";

export type FilterValue = string | string[];
export type FilterState = Record<string, FilterValue>;

const ARRAY_SET = new Set<string>(ARRAY_KEYS);
const SCALAR_SET = new Set<string>(SCALAR_KEYS);

export function isFilterKey(key: string): boolean {
  return ARRAY_SET.has(key) || SCALAR_SET.has(key) || key.startsWith(CUSTOM_FIELD_PREFIX);
}

export function isArrayKey(key: string): boolean {
  return ARRAY_SET.has(key);
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function entries(params: RawParams): [string, string][] {
  if (params instanceof URLSearchParams) return [...params.entries()];
  return Object.entries(params).flatMap(([k, v]): [string, string][] => {
    if (v === undefined) return [];
    return (Array.isArray(v) ? v : [v]).map((x) => [k, x]);
  });
}

/** URL parameters → filter state (only filter keys; empty values dropped; `key[]` accepted). */
export function filtersFromParams(params: RawParams): FilterState {
  const out: FilterState = {};
  for (const [rawKey, rawValue] of entries(params)) {
    const key = rawKey.replace(/\[\]$/, "");
    const value = rawValue.trim();
    if (!value || !isFilterKey(key)) continue;
    if (ARRAY_SET.has(key)) {
      const prev = out[key];
      const list = asArray(prev);
      if (!list.includes(value)) out[key] = [...list, value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** A stored filter object (saved search, dynamic list) → filter state, ignoring unknown keys. */
export function filtersFromObject(input: Record<string, unknown> | null | undefined): FilterState {
  const out: FilterState = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (key === "cf" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null && v !== undefined && String(v) !== "") out[`${CUSTOM_FIELD_PREFIX}${k}`] = String(v);
      }
      continue;
    }
    if (!isFilterKey(key) || value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const list = value.map(String).filter(Boolean);
      if (list.length) out[key] = ARRAY_SET.has(key) ? list : list[0];
    } else if (String(value) !== "") {
      out[key] = ARRAY_SET.has(key) ? [String(value)] : String(value);
    }
  }
  return out;
}

/** Filter state → URLSearchParams (custom fields as `cf.<key>`). */
export function paramsFromFilters(
  filters: FilterState,
  extra: Record<string, string | undefined> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return params;
}

/** Number of active filters (each key counts once), excluding the free-text search box. */
export function activeFilterCount(filters: FilterState): number {
  return Object.entries(filters).filter(
    ([key, value]) =>
      key !== "q" && key !== "similarTitles" && (Array.isArray(value) ? value.length > 0 : Boolean(value)),
  ).length;
}

export function asArray(value: FilterValue | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Human label for an employee range key ("10001+" → "10,001+"). */
export function employeeRangeLabel(key: string): string {
  const range = EMPLOYEE_RANGES.find((r) => r.key === key);
  if (!range) return key;
  return range.max === null
    ? `${range.min.toLocaleString("en-US")}+`
    : `${range.min.toLocaleString("en-US")}–${range.max.toLocaleString("en-US")}`;
}

/** Filters that need a data provider this installation doesn't have: shown disabled in the UI. */
export const PROVIDER_ONLY_FILTERS = [
  "Buying intent",
  "Funding",
  "Headcount growth",
  "Job postings",
  "News",
  "Website visitors",
  "Signals",
  "Scores",
  "Lookalikes",
] as const;

export const SORT_FIELDS: Record<SearchEntity, { value: string; label: string }[]> = {
  contact: [
    { value: "createdAt", label: "Date added" },
    { value: "updatedAt", label: "Last updated" },
    { value: "lastActivityAt", label: "Last activity" },
    { value: "name", label: "Name" },
    { value: "title", label: "Job title" },
    { value: "company", label: "Company" },
    { value: "email", label: "Email" },
    { value: "stage", label: "Stage" },
    { value: "employeeCount", label: "Company employees" },
  ],
  company: [
    { value: "createdAt", label: "Date added" },
    { value: "updatedAt", label: "Last updated" },
    { value: "lastActivityAt", label: "Last activity" },
    { value: "name", label: "Name" },
    { value: "domain", label: "Domain" },
    { value: "employeeCount", label: "Employees" },
    { value: "annualRevenue", label: "Revenue" },
    { value: "foundedYear", label: "Founded" },
    { value: "stage", label: "Stage" },
  ],
};

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;
