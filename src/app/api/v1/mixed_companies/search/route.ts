import { pageFrom, readJson, route } from "@/server/http/route";
import { companySearchSchema, fromApolloCompanySearch, searchCompanies } from "@/server/services/companies";
import { asObject } from "@/server/services/records";
import { searchCounts } from "@/server/services/search-filters";

/**
 * Company search over the workspace's own records (there is no shared prospect database).
 * Accepts our camelCase filters and common Apollo parameter names. `includeCounts: true` adds
 * Total / Net new / Saved counts and facet counts per filter option.
 */
export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    const { includeCounts, include_counts, ...rest } = body;
    const filters = companySearchSchema.parse(fromApolloCompanySearch(rest));
    const result = await searchCompanies(actor, filters, pageFrom(rest));
    const counts =
      includeCounts === true || include_counts === true ? await searchCounts(actor, "company", filters) : {};
    return { organizations: result.accounts, pagination: result.pagination, breadcrumbs: [], ...counts };
  },
  { permission: "search:run" },
);
