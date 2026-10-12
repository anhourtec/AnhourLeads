/**
 * Rule-based "describe who you're looking for" parser. Turns a sentence such as
 * "VP sales in Canada at software companies with 50-200 employees" into search filters, without
 * any external AI. Pure and dependency-free so it runs in the browser, on the server and in tests.
 */

export interface ParsedSearch {
  titles?: string[];
  location?: string[];
  industry?: string[];
  company?: string[];
  employeesMin?: string;
  employeesMax?: string;
  emailStatus?: string[];
}

export interface ParserVocabulary {
  /** Locations known in the workspace (countries, states, cities), matched case-insensitively. */
  locations?: string[];
  /** Industries known in the workspace. */
  industries?: string[];
}

const COUNTRIES = [
  "United States",
  "Canada",
  "Mexico",
  "Brazil",
  "Argentina",
  "Chile",
  "Colombia",
  "United Kingdom",
  "Ireland",
  "France",
  "Germany",
  "Spain",
  "Portugal",
  "Italy",
  "Netherlands",
  "Belgium",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Czech Republic",
  "Romania",
  "Greece",
  "Turkey",
  "Israel",
  "United Arab Emirates",
  "Saudi Arabia",
  "Egypt",
  "Nigeria",
  "Kenya",
  "South Africa",
  "India",
  "Pakistan",
  "Bangladesh",
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "Vietnam",
  "Thailand",
  "China",
  "Hong Kong",
  "Taiwan",
  "Japan",
  "South Korea",
  "Australia",
  "New Zealand",
];

const REGIONS = [
  "California",
  "New York",
  "Texas",
  "Florida",
  "Washington",
  "Massachusetts",
  "Illinois",
  "Colorado",
  "Georgia",
  "Ontario",
  "Quebec",
  "British Columbia",
  "Alberta",
  "London",
  "Paris",
  "Berlin",
  "Toronto",
  "Vancouver",
  "Montreal",
  "San Francisco",
  "Los Angeles",
  "Seattle",
  "Boston",
  "Chicago",
  "Austin",
  "Sydney",
  "Bangalore",
];

const LOCATION_ALIASES: Record<string, string> = {
  us: "United States",
  usa: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  america: "United States",
  "the us": "United States",
  "the usa": "United States",
  "the united states": "United States",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  "the uk": "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  uae: "United Arab Emirates",
  "the netherlands": "Netherlands",
  holland: "Netherlands",
  nyc: "New York",
  sf: "San Francisco",
  "bay area": "San Francisco",
};

const INDUSTRIES = [
  "software",
  "saas",
  "fintech",
  "financial services",
  "banking",
  "insurance",
  "healthcare",
  "biotech",
  "pharmaceuticals",
  "medical devices",
  "education",
  "edtech",
  "e-commerce",
  "ecommerce",
  "retail",
  "manufacturing",
  "logistics",
  "transportation",
  "real estate",
  "construction",
  "energy",
  "oil & gas",
  "telecommunications",
  "media",
  "marketing",
  "advertising",
  "consulting",
  "legal",
  "hospitality",
  "travel",
  "automotive",
  "aerospace",
  "agriculture",
  "food & beverage",
  "gaming",
  "cybersecurity",
  "information technology",
  "information technology & services",
  "nonprofit",
  "government",
  "hardware",
  "semiconductors",
  "staffing",
  "recruiting",
];

/** Words that end in "s" but aren't plurals in job titles. */
const NOT_PLURAL = new Set([
  "sales",
  "operations",
  "analytics",
  "services",
  "business",
  "logistics",
  "relations",
  "communications",
  "systems",
  "success",
  "ops",
  "resources",
  "affairs",
  "economics",
  "status",
  "news",
  "access",
  "process",
]);

const LEADING_NOISE =
  /^(?:please\s+)?(?:find|show(?:\s+me)?|search(?:\s+for)?|get(?:\s+me)?|list|look(?:ing)?\s+for|i(?:'m|\s+am)\s+looking\s+for|who\s+are|all|the|top|leading|some|any)\b\s*/i;
const TRAILING_NOISE = /\s*\b(?:people|persons|prospects|contacts|leads|who\s+work|working|employees)\s*$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function intOf(value: string): number {
  return Number.parseInt(value.replace(/[,\s]/g, ""), 10);
}

function singular(word: string): string {
  const lower = word.toLowerCase();
  if (word.length <= 3 || NOT_PLURAL.has(lower)) return word;
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us)$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

function splitList(value: string): string[] {
  return value
    .split(/\s*(?:,|\bor\b|\band\b|\/)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function canonicalLocation(phrase: string, known: string[]): string | null {
  const lower = phrase
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  if (!lower) return null;
  if (LOCATION_ALIASES[lower]) return LOCATION_ALIASES[lower];
  const found = known.find((k) => k.toLowerCase() === lower);
  return found ?? null;
}

function canonicalIndustry(phrase: string, known: string[]): string | null {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return null;
  const found = known.find((k) => k.toLowerCase() === lower);
  return found ?? null;
}

/**
 * Parse a sentence into filters. Unrecognised words become a job title (people search), so the
 * result is always something the user can see and edit as filter chips.
 */
export function parseNaturalLanguage(input: string, vocabulary: ParserVocabulary = {}): ParsedSearch {
  const result: ParsedSearch = {};
  const locations = [...new Set([...(vocabulary.locations ?? []), ...COUNTRIES, ...REGIONS])].sort(
    (a, b) => b.length - a.length,
  );
  const industries = [...new Set([...(vocabulary.industries ?? []), ...INDUSTRIES])].sort(
    (a, b) => b.length - a.length,
  );
  let text = ` ${input.replace(/\s+/g, " ").trim()} `;

  const take = (pattern: RegExp, handle: (m: RegExpMatchArray) => boolean | undefined): void => {
    const match = text.match(pattern);
    if (match && handle(match) !== false) text = text.replace(match[0], " ");
  };

  // Company size.
  take(
    /\b(?:with\s+|having\s+)?(?:between\s+)?(\d[\d,]*)\s*(?:-|–|to|and)\s*(\d[\d,]*)\s*(?:employees|people|staff|headcount|emp)\b/i,
    (m) => {
      const a = intOf(m[1]);
      const b = intOf(m[2]);
      result.employeesMin = String(Math.min(a, b));
      result.employeesMax = String(Math.max(a, b));
      return true;
    },
  );
  take(/\b(?:with\s+)?(\d[\d,]*)\s*\+\s*(?:employees|people|staff)\b/i, (m) => {
    result.employeesMin = String(intOf(m[1]));
    return true;
  });
  take(
    /\b(?:with\s+)?(?:over|more\s+than|at\s+least|above|greater\s+than)\s+(\d[\d,]*)\s*(?:employees|people|staff)\b/i,
    (m) => {
      result.employeesMin = String(intOf(m[1]) + (/at\s+least/i.test(m[0]) ? 0 : 1));
      return true;
    },
  );
  take(
    /\b(?:with\s+)?(?:under|less\s+than|fewer\s+than|below|up\s+to|at\s+most)\s+(\d[\d,]*)\s*(?:employees|people|staff)\b/i,
    (m) => {
      const n = intOf(m[1]);
      result.employeesMax = String(/up\s+to|at\s+most/i.test(m[0]) ? n : Math.max(0, n - 1));
      return true;
    },
  );

  // Email status.
  take(/\b(?:with|who\s+have|having)\s+(?:a\s+)?(?:verified|valid)\s+emails?\b/i, () => {
    result.emailStatus = ["valid"];
    return true;
  });

  // "at software companies", "at fintech or saas companies" → industries.
  take(
    /\b(?:at|in|from|for)\s+((?:(?!\b(?:at|in|from|for|with)\b)[a-z0-9&,/\- ])+?)\s+(?:companies|company|firms|businesses|startups|organizations)\b/i,
    (m) => {
      const parts = splitList(m[1]).map((p) => canonicalIndustry(p, industries) ?? p.toLowerCase());
      if (!parts.length) return false;
      result.industry = [...new Set([...(result.industry ?? []), ...parts])];
      return true;
    },
  );

  // "in Canada", "based in New York", "in fintech".
  for (let guard = 0; guard < 5; guard++) {
    let matched = false;
    for (const candidate of [...locations, ...Object.keys(LOCATION_ALIASES).sort((a, b) => b.length - a.length)]) {
      const re = new RegExp(
        `\\b(?:based\\s+in|located\\s+in|in|from)\\s+(${escapeRegExp(candidate)})(?=[\\s,.!?]|$)`,
        "i",
      );
      const m = text.match(re);
      if (m) {
        const loc = canonicalLocation(m[1], locations);
        if (loc) {
          result.location = [...new Set([...(result.location ?? []), loc])];
          text = text.replace(m[0], " ");
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      for (const candidate of industries) {
        const re = new RegExp(
          `\\b(?:in|within)\\s+(?:the\\s+)?(${escapeRegExp(candidate)})(?:\\s+(?:industry|space|sector))?(?=[\\s,.!?]|$)`,
          "i",
        );
        const m = text.match(re);
        if (m) {
          result.industry = [...new Set([...(result.industry ?? []), canonicalIndustry(m[1], industries) ?? m[1]])];
          text = text.replace(m[0], " ");
          matched = true;
          break;
        }
      }
    }
    if (!matched) break;
  }

  // "at Acme" → company name.
  take(
    /\b(?:at|working\s+at|who\s+work\s+at|from)\s+([A-Z0-9][\w&.\- ]*?)(?=\s+(?:with|in|who)\b|[,.!?]|\s*$)/,
    (m) => {
      const name = m[1].trim();
      if (!name) return false;
      result.company = [name];
      return true;
    },
  );

  // Whatever is left is the role.
  let rest = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,.!?]+$/, "");
  for (let i = 0; i < 4; i++) rest = rest.replace(LEADING_NOISE, "").trim();
  rest = rest
    .replace(TRAILING_NOISE, "")
    .replace(/\b(?:who|that|with|and|in|at|of)\s*$/i, "")
    .trim();
  if (rest) {
    const titles = splitList(rest)
      .map((t) => t.split(/\s+/).map(singular).join(" "))
      .filter((t) => t.length > 1);
    if (titles.length) result.titles = [...new Set(titles)];
  }
  return result;
}
