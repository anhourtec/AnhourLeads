import { pageFrom, readJson, route } from "@/server/http/route";
import { contactSearchSchema, fromApolloPeopleSearch, searchContacts } from "@/server/services/contacts";
import { asObject } from "@/server/services/records";
import { searchCounts } from "@/server/services/search-filters";

/**
 * People search over the workspace's own records (there is no shared prospect database), with
 * company attribute filters. Accepts our camelCase filters and common Apollo parameter names.
 * `includeCounts: true` adds Total / Net new / Saved counts and facet counts per filter option.
 */
export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    const { includeCounts, include_counts, ...rest } = body;
    const filters = contactSearchSchema.parse(fromApolloPeopleSearch(rest));
    const result = await searchContacts(actor, filters, pageFrom(rest));
    const counts =
      includeCounts === true || include_counts === true ? await searchCounts(actor, "contact", filters) : {};
    return { people: result.contacts, pagination: result.pagination, breadcrumbs: [], ...counts };
  },
  { permission: "search:run" },
);
