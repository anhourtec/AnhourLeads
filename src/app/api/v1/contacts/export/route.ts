import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { contactSearchSchema, exportContacts } from "@/server/services/contacts";
import { csvResponse, queryObject } from "@/server/services/records";

/** CSV download of the filtered contacts (same filters as search, in the query string). */
export const GET = route(
  async ({ req, actor }) => {
    const { csv } = await exportContacts(actor, contactSearchSchema.parse(queryObject(req.url)));
    return csvResponse(`people-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  },
  { permission: "contact:export", limit: LIMITS.sensitive },
);
