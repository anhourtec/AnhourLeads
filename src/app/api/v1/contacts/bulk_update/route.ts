import { readJson, route } from "@/server/http/route";
import { bulkUpdateContacts, contactBulkUpdateSchema } from "@/server/services/contacts";

/** Apply the same values to up to 1,000 contacts. */
export const POST = route(
  async ({ req, actor }) => {
    const { contactIds, ...fields } = contactBulkUpdateSchema.parse(await readJson(req));
    return bulkUpdateContacts(actor, contactIds, fields);
  },
  { permission: "contact:update" },
);
