import { pageFrom, readJson, route } from "@/server/http/route";
import { contactSearchSchema, searchContacts } from "@/server/services/contacts";
import { asObject } from "@/server/services/records";

export const POST = route(
  async ({ req, actor }) => {
    const body = asObject(await readJson(req));
    return searchContacts(actor, contactSearchSchema.parse(body), pageFrom(body));
  },
  { permission: "contact:read" },
);
