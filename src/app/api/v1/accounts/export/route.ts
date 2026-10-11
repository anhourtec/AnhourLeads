import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { companySearchSchema, exportCompanies } from "@/server/services/companies";
import { asObject, csvResponse, queryObject } from "@/server/services/records";

const filename = () => `companies-${new Date().toISOString().slice(0, 10)}.csv`;

/** CSV download of the filtered accounts (same filters as search, in the query string). */
export const GET = route(
  async ({ req, actor }) => {
    const { csv } = await exportCompanies(actor, companySearchSchema.parse(queryObject(req.url)));
    return csvResponse(filename(), csv);
  },
  { permission: "company:export", limit: LIMITS.sensitive },
);

/** Same as GET with the filters in a JSON body (e.g. `{ ids: [...] }` for a selection). */
export const POST = route(
  async ({ req, actor }) => {
    const { csv } = await exportCompanies(actor, companySearchSchema.parse(asObject(await readJson(req))));
    return csvResponse(filename(), csv);
  },
  { permission: "company:export", limit: LIMITS.sensitive },
);
