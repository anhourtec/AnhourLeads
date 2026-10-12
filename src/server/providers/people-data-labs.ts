import "server-only";

import { baseUrl, email, int, linkedin, obj, providerFetch, seniority, str, year } from "./http";
import {
  type CompanyResult,
  emptyCompany,
  emptyPerson,
  type PersonQuery,
  type PersonResult,
  type ProviderClient,
} from "./types";

/**
 * People Data Labs (https://docs.peopledatalabs.com): person enrichment, company enrichment, and
 * the free autocomplete API for the connection test. Auth: `X-Api-Key`. 404 means no match (free).
 */
const DEFAULT_URL = "https://api.peopledatalabs.com";

function sentence(value: string | null): string | null {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
}

export function peopleDataLabs(apiKey: string): ProviderClient {
  const headers = { "x-api-key": apiKey };
  const url = (path: string, params: Record<string, string | null | undefined>) => {
    const u = new URL(`${baseUrl(DEFAULT_URL)}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return u.toString();
  };

  return {
    id: "people_data_labs",
    personFields: true,
    companyFields: true,

    async matchPerson(q: PersonQuery): Promise<PersonResult | null> {
      const { status, body } = await providerFetch(
        "people_data_labs",
        url("/v5/person/enrich", {
          first_name: q.firstName,
          last_name: q.lastName,
          name: q.firstName || q.lastName ? null : q.name,
          company: q.domain ?? q.companyName,
          email: q.email,
          profile: q.linkedinUrl,
          min_likelihood: "6",
          titlecase: "true",
        }),
        { headers },
      );
      if (status === 404) return null;
      const data = obj(obj(body)?.data);
      if (!data) return null;
      const emails = Array.isArray(data.emails) ? data.emails.map(obj) : [];
      const professional = emails.find((e) => e && str(e.type) === "current_professional");
      const phones = Array.isArray(data.phone_numbers) ? data.phone_numbers : [];
      return {
        ...emptyPerson(),
        email: email(data.work_email) ?? email(professional?.address),
        title: str(data.job_title, 200),
        seniority: seniority(data.job_title_levels),
        phone: str(data.mobile_phone, 40) ?? str(phones[0], 40),
        linkedinUrl: linkedin(data.linkedin_url),
        city: str(data.location_locality, 120),
        state: str(data.location_region, 120),
        country: str(data.location_country, 120),
      };
    },

    async enrichCompany({ domain }): Promise<CompanyResult | null> {
      const { status, body } = await providerFetch(
        "people_data_labs",
        url("/v5/company/enrich", { website: domain, titlecase: "true" }),
        { headers },
      );
      if (status === 404) return null;
      const data = obj(body);
      if (!data) return null;
      const location = obj(data.location);
      return {
        ...emptyCompany(),
        name: str(data.display_name, 200) ?? str(data.name, 200),
        industry: sentence(str(data.industry, 120)),
        employeeCount: int(data.employee_count),
        foundedYear: year(data.founded),
        linkedinUrl: linkedin(data.linkedin_url),
        country: str(location?.country, 120),
        state: str(location?.region, 120),
        city: str(location?.locality, 120),
        description: str(data.summary, 2000),
      };
    },

    async testConnection(): Promise<void> {
      await providerFetch("people_data_labs", url("/v5/autocomplete", { field: "company", text: "a", size: "1" }), {
        headers,
      });
    },
  };
}
