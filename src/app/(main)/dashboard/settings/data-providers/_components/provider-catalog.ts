import type { DataProviderDto } from "@/server/services/data-providers";

export type ProviderId = DataProviderDto["provider"];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** What it adds to enrichment, in one or two sentences. */
  adds: string;
  /** How the connection test avoids spending credits. */
  test: string;
  pricingUrl: string;
  docsUrl: string;
}

/** The providers a workspace can connect, in the order enrichment tries them. */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "people_data_labs",
    name: "People Data Labs",
    adds: "Work emails, job titles, seniority, phone numbers, LinkedIn profiles and locations for people, plus industry, head count, founding year and location for companies.",
    test: "The connection test uses the free autocomplete API.",
    pricingUrl: "https://www.peopledatalabs.com/pricing",
    docsUrl: "https://docs.peopledatalabs.com/docs/reference-person-enrichment-api",
  },
  {
    id: "apollo",
    name: "Apollo",
    adds: "Work emails with Apollo's status, titles, seniority, LinkedIn profiles and locations for people, plus firmographics for companies. Personal emails and phone reveals are never requested.",
    test: "The connection test calls Apollo's health check, which spends no credits.",
    pricingUrl: "https://www.apollo.io/pricing",
    docsUrl: "https://docs.apollo.io/reference/people-enrichment",
  },
  {
    id: "hunter",
    name: "Hunter",
    adds: "Work email addresses found from a name and a company domain, with Hunter's own verification. Used only while an address is missing.",
    test: "The connection test reads your account details, which is free.",
    pricingUrl: "https://hunter.io/pricing",
    docsUrl: "https://hunter.io/api-documentation/v2",
  },
];
