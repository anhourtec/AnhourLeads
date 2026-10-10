import { pageFrom, readJson, route } from "@/server/http/route";
import { companySearchSchema, fromApolloCompanySearch, searchCompanies } from "@/server/services/companies";
import { asObject } from "@/server/services/records";

/**
 * Company search over the workspace's own records (there is no shared prospect database).
 * Accepts our camelCase filters and common Apollo parameter names.
 */
export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    const result = await searchCompanies(
      actor,
      companySearchSchema.parse(fromApolloCompanySearch(body)),
      pageFrom(body),
    );
    return { organizations: result.accounts, pagination: result.pagination, breadcrumbs: [] };
  },
  { permission: "search:run" },
);
