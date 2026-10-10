import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { companySearchSchema, exportCompanies } from "@/server/services/companies";
import { csvResponse, queryObject } from "@/server/services/records";

/** CSV download of the filtered accounts (same filters as search, in the query string). */
export const GET = route(
  async ({ req, actor }) => {
    const { csv } = await exportCompanies(actor, companySearchSchema.parse(queryObject(req.url)));
    return csvResponse(`companies-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  },
  { permission: "company:export", limit: LIMITS.sensitive },
);
