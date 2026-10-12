/** Shapes shared by the crawler, the research service and the research screen. */

export type FactField =
  | "name"
  | "siteName"
  | "title"
  | "description"
  | "phone"
  | "linkedinUrl"
  | "twitterUrl"
  | "githubUrl"
  | "facebookUrl"
  | "foundedYear"
  | "copyrightYear"
  | "city"
  | "country"
  | "employeeCount"
  | "logoUrl";

export interface Fact {
  field: FactField;
  value: string;
  sourceUrl: string;
  confidence: number;
  method: string;
}

export interface FoundEmail {
  email: string;
  sourceUrl: string;
  method: "mailto" | "text" | "obfuscated" | "cloudflare" | "json_ld";
  /** Set after verification (EMAIL_STATUSES). */
  status?: string;
  statusReason?: string;
  /** Name of a found person this address appears to belong to. */
  person?: string;
}

export interface FoundPhone {
  value: string;
  sourceUrl: string;
  method: "tel" | "text" | "json_ld";
}

export type SocialNetwork = "linkedin" | "twitter" | "github" | "facebook";

export interface FoundSocial {
  network: SocialNetwork;
  url: string;
  sourceUrl: string;
}

export interface FoundTechnology {
  name: string;
  category: string;
  evidence: string;
  sourceUrl: string;
}

export interface FoundPerson {
  name: string;
  firstName: string;
  lastName: string;
  title: string | null;
  sourceUrl: string;
  method: "json_ld" | "microdata" | "markup";
  confidence: number;
  linkedinUrl: string | null;
  email: string | null;
}

export interface HiringSignal {
  careersUrl: string | null;
  jobCount: number | null;
  ats: string[];
  mentions: string[];
}

export interface RobotsSummary {
  url: string;
  status: "found" | "missing" | "unreachable";
  crawlDelaySeconds: number | null;
  matchedAgent: string | null;
  disallowRules: number;
}

/** Everything found on one page. */
export interface PageExtract {
  title: string | null;
  facts: Fact[];
  emails: FoundEmail[];
  phones: FoundPhone[];
  social: FoundSocial[];
  technologies: FoundTechnology[];
  people: FoundPerson[];
  hiring: HiringSignal;
  links: Array<{ url: string; text: string }>;
}

/** Everything found in one crawl job (stored in crawl_job.result). */
export interface CrawlFindings {
  seedUrl: string;
  domain: string;
  facts: Fact[];
  emails: FoundEmail[];
  phones: FoundPhone[];
  social: FoundSocial[];
  technologies: FoundTechnology[];
  people: FoundPerson[];
  hiring: HiringSignal;
  robots: RobotsSummary | null;
  emailPattern: { pattern: string; confidence: number; matches: number } | null;
  /** Addresses dropped because they are on the do-not-contact list. */
  suppressedEmails: number;
}

export interface CrawlPageRecord {
  url: string;
  statusCode: number | null;
  title: string | null;
  skippedReason: string | null;
}

export const SKIP_REASONS = [
  "robots",
  "offsite",
  "too_large",
  "not_html",
  "blocked_host",
  "timeout",
  "too_many_redirects",
  "http_error",
  "network",
  "dns",
  "duplicate",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
