import "server-only";

import type { EmailStatus } from "@/server/db/schema";

import { baseUrl, email, linkedin, obj, providerFetch, str } from "./http";
import {
  type CompanyResult,
  emptyCompany,
  emptyPerson,
  type PersonQuery,
  type PersonResult,
  type ProviderClient,
} from "./types";

/**
 * Hunter (https://hunter.io/api-documentation/v2): email finder and domain search only, and the
 * free `/v2/account` call for the connection test. Auth: the `api_key` query parameter.
 * Hunter answers 403 for its rate limit and 429 when the plan's quota is used up.
 */
const DEFAULT_URL = "https://api.hunter.io";

const VERIFICATION: Record<string, EmailStatus> = {
  valid: "valid",
  invalid: "invalid",
  accept_all: "catch_all",
  webmail: "valid",
  disposable: "disposable",
  unknown: "unknown",
};

/** Hunter's 403 is its rate limit and 429 its usage limit; map them to the shared meanings. */
const HUNTER_STATUS: Record<number, number> = { 403: 429, 429: 402 };
const statusMap = (s: number) => HUNTER_STATUS[s] ?? s;

export function hunter(apiKey: string): ProviderClient {
  const url = (path: string, params: Record<string, string | null | undefined> = {}) => {
    const u = new URL(`${baseUrl(DEFAULT_URL)}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    u.searchParams.set("api_key", apiKey);
    return u.toString();
  };

  return {
    id: "hunter",
    personFields: false,
    companyFields: false,

    async matchPerson(q: PersonQuery): Promise<PersonResult | null> {
      const named = Boolean(q.firstName && q.lastName) || Boolean(q.name);
      if (!named || !(q.domain || q.companyName)) return null;
      const { status, body } = await providerFetch(
        "hunter",
        url("/v2/email-finder", {
          domain: q.domain,
          company: q.domain ? null : q.companyName,
          first_name: q.firstName && q.lastName ? q.firstName : null,
          last_name: q.firstName && q.lastName ? q.lastName : null,
          full_name: q.firstName && q.lastName ? null : q.name,
        }),
        { statusMap },
      );
      if (status === 404) return null;
      const data = obj(obj(body)?.data);
      const found = email(data?.email);
      if (!data || !found) return null;
      const verification = str(obj(data.verification)?.status)?.toLowerCase() ?? null;
      const score = typeof data.score === "number" ? Math.min(100, Math.max(0, data.score)) / 100 : null;
      return {
        ...emptyPerson(),
        email: found,
        emailStatus: verification ? (VERIFICATION[verification] ?? null) : null,
        emailConfidence: score,
        title: str(data.position, 200),
        phone: str(data.phone_number, 40),
        linkedinUrl: linkedin(data.linkedin_url),
      };
    },

    async enrichCompany({ domain }): Promise<CompanyResult | null> {
      const { status, body } = await providerFetch("hunter", url("/v2/domain-search", { domain, limit: "1" }), {
        statusMap,
      });
      if (status === 404) return null;
      const data = obj(obj(body)?.data);
      if (!data) return null;
      return { ...emptyCompany(), name: str(data.organization, 200) };
    },

    async testConnection(): Promise<void> {
      await providerFetch("hunter", url("/v2/account"), { statusMap });
    },
  };
}
