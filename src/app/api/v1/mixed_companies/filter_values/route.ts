import { route } from "@/server/http/route";
import { filterValues, filterValuesQuery } from "@/server/services/search-filters";

/** Distinct values in the workspace for a filter typeahead (`field`, optional `q`), most common first. */
export const GET = route(
  async ({ req, actor }) => {
    const { field, q, limit } = filterValuesQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    return { values: await filterValues(actor, "company", field, q ?? "", limit ?? 20) };
  },
  { permission: "search:run" },
);
