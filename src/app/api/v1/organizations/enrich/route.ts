import type { NextRequest } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { enrichOrganization, organizationEnrichInput } from "@/server/services/enrichment";

/**
 * Enrich one organization from its public website: reuses a crawl from the last 7 days or runs a
 * small one (5 pages) now. With a known company, the findings are written to it with provenance.
 */
function queryInput(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const flag = (name: string) => (q.has(name) ? q.get(name) === "true" : undefined);
  return {
    domain: q.get("domain") || undefined,
    website: q.get("website") || undefined,
    companyId: q.get("companyId") || q.get("company_id") || undefined,
    name: q.get("name") || undefined,
    apply: flag("apply"),
    reuse: flag("reuse"),
  };
}

export const GET = route(
  async ({ req, actor }) => enrichOrganization(actor, organizationEnrichInput.parse(queryInput(req))),
  { permission: "enrich:run", limit: LIMITS.sensitive },
);

export const POST = route(
  async ({ req, actor }) => enrichOrganization(actor, organizationEnrichInput.parse(await readJson(req))),
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
