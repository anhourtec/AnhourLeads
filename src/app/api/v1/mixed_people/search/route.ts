import { pageFrom, readJson, route } from "@/server/http/route";
import { contactSearchSchema, fromApolloPeopleSearch, searchContacts } from "@/server/services/contacts";
import { asObject } from "@/server/services/records";

/**
 * People search over the workspace's own records (there is no shared prospect database), with
 * company attribute filters. Accepts our camelCase filters and common Apollo parameter names.
 */
export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    const result = await searchContacts(actor, contactSearchSchema.parse(fromApolloPeopleSearch(body)), pageFrom(body));
    return { people: result.contacts, pagination: result.pagination, breadcrumbs: [] };
  },
  { permission: "search:run" },
);
