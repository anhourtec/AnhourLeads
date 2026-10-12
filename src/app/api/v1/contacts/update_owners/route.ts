import { readJson, route } from "@/server/http/route";
import { bulkUpdateContacts, contactOwnersSchema } from "@/server/services/contacts";

export const POST = route(
  async ({ req, actor }) => {
    const { contactIds, ownerId } = contactOwnersSchema.parse(await readJson(req));
    return bulkUpdateContacts(actor, contactIds, { ownerId }, "contact.update_owners");
  },
  { permission: "contact:update" },
);
