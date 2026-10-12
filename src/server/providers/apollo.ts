import "server-only";

import type { EmailStatus } from "@/server/db/schema";

import { baseUrl, email, int, linkedin, obj, providerFetch, seniority, str, year } from "./http";
import {
  type CompanyResult,
  emptyCompany,
  emptyPerson,
  type PersonQuery,
  type PersonResult,
  type ProviderClient,
  ProviderError,
} from "./types";

/**
 * Apollo (https://docs.apollo.io): `POST /api/v1/people/match`, `GET /api/v1/organizations/enrich`,
 * and `GET /api/v1/auth/health` (no credits) for the connection test. Auth: `X-Api-Key`.
 * Personal emails and phone reveals are never requested (they cost extra and need a webhook).
 */
const DEFAULT_URL = "https://api.apollo.io";

const EMAIL_STATUS: Record<string, EmailStatus> = {
  verified: "valid",
  likely_to_engage: "valid",
  unverified: "unverified",
  guessed: "unverified",
  extrapolated: "unverified",
  unavailable: "unknown",
  bounced: "invalid",
  pending_manual_fulfillment: "unknown",
};

export function apollo(apiKey: string): ProviderClient {
  const headers = { "x-api-key": apiKey, "cache-control": "no-cache" };
  const url = (path: string, params: Record<string, string | null | undefined> = {}) => {
    const u = new URL(`${baseUrl(DEFAULT_URL)}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return u.toString();
  };

  return {
    id: "apollo",
    personFields: true,
    companyFields: true,

    async matchPerson(q: PersonQuery): Promise<PersonResult | null> {
      const { status, body } = await providerFetch(
        "apollo",
        url("/api/v1/people/match", {
          first_name: q.firstName,
          last_name: q.lastName,
          name: q.firstName || q.lastName ? null : q.name,
          email: q.email,
          domain: q.domain,
          organization_name: q.companyName,
          linkedin_url: q.linkedinUrl,
          reveal_personal_emails: "false",
          reveal_phone_number: "false",
        }),
        { method: "POST", headers },
      );
      if (status === 404) return null;
      const person = obj(obj(body)?.person);
      if (!person) return null;
      const contact = obj(person.contact);
      const phones = Array.isArray(contact?.phone_numbers) ? contact.phone_numbers.map(obj) : [];
      const statusText = str(person.email_status)?.toLowerCase() ?? null;
      const found = email(person.email);
      // Apollo masks locked addresses as email_not_unlocked@domain.com.
      const usable = found && !found.startsWith("email_not_unlocked@") ? found : null;
      return {
        ...emptyPerson(),
        email: usable,
        emailStatus: usable && statusText ? (EMAIL_STATUS[statusText] ?? null) : null,
        title: str(person.title, 200),
        seniority: seniority(person.seniority),
        phone: str(phones[0]?.sanitized_number, 40) ?? str(phones[0]?.raw_number, 40),
        linkedinUrl: linkedin(person.linkedin_url),
        city: str(person.city, 120),
        state: str(person.state, 120),
        country: str(person.country, 120),
      };
    },

    async enrichCompany({ domain }): Promise<CompanyResult | null> {
      const { status, body } = await providerFetch("apollo", url("/api/v1/organizations/enrich", { domain }), {
        headers,
      });
      if (status === 404) return null;
      const org = obj(obj(body)?.organization);
      if (!org) return null;
      return {
        ...emptyCompany(),
        name: str(org.name, 200),
        industry: str(org.industry, 120),
        employeeCount: int(org.estimated_num_employees),
        foundedYear: year(org.founded_year),
        linkedinUrl: linkedin(org.linkedin_url),
        country: str(org.country, 120),
        state: str(org.state, 120),
        city: str(org.city, 120),
        description: str(org.short_description, 2000),
        phone: str(obj(org.primary_phone)?.sanitized_number, 40) ?? str(org.phone, 40),
      };
    },

    async testConnection(): Promise<void> {
      const { body } = await providerFetch("apollo", url("/api/v1/auth/health"), { headers });
      if (obj(body)?.is_logged_in === false) {
        throw new ProviderError("unauthorized", "Apollo rejected the API key. Check it and save it again.");
      }
    },
  };
}
