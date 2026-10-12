import { readJson, route } from "@/server/http/route";
import { bulkDeleteContacts, contactBulkDeleteSchema } from "@/server/services/contacts";

export const POST = route(
  async ({ req, actor }) => {
    const { contactIds } = contactBulkDeleteSchema.parse(await readJson(req));
    return bulkDeleteContacts(actor, contactIds);
  },
  { permission: "contact:delete" },
);
