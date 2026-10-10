import { readJson, route } from "@/server/http/route";
import { bulkCreateContacts, contactBulkCreateSchema } from "@/server/services/contacts";

/** Up to 100 contacts; existing ones (same email) are returned untouched in `existing_contacts`. */
export const POST = route(
  async ({ req, actor }) => {
    const body = contactBulkCreateSchema.parse(await readJson(req));
    return bulkCreateContacts(actor, body.contacts, body.ownerId);
  },
  { permission: "contact:create" },
);
