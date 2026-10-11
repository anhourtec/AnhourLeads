import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { contactSearchSchema, exportContacts } from "@/server/services/contacts";
import { asObject, csvResponse, queryObject } from "@/server/services/records";

const filename = () => `people-${new Date().toISOString().slice(0, 10)}.csv`;

/** CSV download of the filtered contacts (same filters as search, in the query string). */
export const GET = route(
  async ({ req, actor }) => {
    const { csv } = await exportContacts(actor, contactSearchSchema.parse(queryObject(req.url)));
    return csvResponse(filename(), csv);
  },
  { permission: "contact:export", limit: LIMITS.sensitive },
);

/** Same as GET with the filters in a JSON body (e.g. `{ ids: [...] }` for a selection). */
export const POST = route(
  async ({ req, actor }) => {
    const { csv } = await exportContacts(actor, contactSearchSchema.parse(asObject(await readJson(req))));
    return csvResponse(filename(), csv);
  },
  { permission: "contact:export", limit: LIMITS.sensitive },
);
