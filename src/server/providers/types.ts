import "server-only";

import type { EmailStatus } from "@/server/db/schema";

/**
 * Bring-your-own data providers: a workspace's own key for an outside data service, used to fill
 * gaps the discovery index and the crawler leave. Results go only into that workspace's records.
 */
export const PROVIDER_IDS = ["people_data_labs", "apollo", "hunter"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  people_data_labs: "People Data Labs",
  apollo: "Apollo",
  hunter: "Hunter",
};

export const SENIORITIES = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
  "senior",
  "entry",
  "intern",
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export interface PersonQuery {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  domain?: string | null;
  companyName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
}

/** Normalised person fields. Anything the provider didn't return is null. */
export interface PersonResult {
  email: string | null;
  emailStatus: EmailStatus | null;
  /** The provider's own confidence in the address, 0..1, when it gives one. */
  emailConfidence: number | null;
  title: string | null;
  seniority: Seniority | null;
  phone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface CompanyResult {
  name: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  linkedinUrl: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  description: string | null;
  phone: string | null;
}

export interface ProviderClient {
  id: ProviderId;
  /** Whether the provider can fill person fields beyond the email address. */
  personFields: boolean;
  /** Whether enrichCompany is worth calling (Hunter returns little more than a name). */
  companyFields: boolean;
  matchPerson(query: PersonQuery): Promise<PersonResult | null>;
  enrichCompany(input: { domain: string }): Promise<CompanyResult | null>;
  /** One cheap call that proves the key works without spending lookup credits. */
  testConnection(): Promise<void>;
}

export type ProviderErrorCode =
  | "unauthorized"
  | "no_credits"
  | "rate_limited"
  | "forbidden"
  | "timeout"
  | "unavailable"
  | "bad_response";

/** A provider call that failed. `message` is a plain sentence safe to store and show; never provider text. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function emptyPerson(): PersonResult {
  return {
    email: null,
    emailStatus: null,
    emailConfidence: null,
    title: null,
    seniority: null,
    phone: null,
    linkedinUrl: null,
    city: null,
    state: null,
    country: null,
  };
}

export function emptyCompany(): CompanyResult {
  return {
    name: null,
    industry: null,
    employeeCount: null,
    foundedYear: null,
    linkedinUrl: null,
    country: null,
    state: null,
    city: null,
    description: null,
    phone: null,
  };
}
