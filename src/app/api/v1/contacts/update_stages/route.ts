import { readJson, route } from "@/server/http/route";
import { bulkUpdateContacts, contactStagesSchema } from "@/server/services/contacts";

export const POST = route(
  async ({ req, actor }) => {
    const { contactIds, stage } = contactStagesSchema.parse(await readJson(req));
    return bulkUpdateContacts(actor, contactIds, { stage }, "contact.update_stages");
  },
  { permission: "contact:update" },
);
