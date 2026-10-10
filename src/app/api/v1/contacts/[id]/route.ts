import { readJson, route } from "@/server/http/route";
import { contactUpdateSchema, deleteContact, getContact, updateContact } from "@/server/services/contacts";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ contact: await getContact(actor, params.id) }), {
  permission: "contact:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => {
    const patch = contactUpdateSchema.parse(await readJson(req));
    return { contact: await updateContact(actor, params.id, patch) };
  },
  { permission: "contact:update" },
);

export const DELETE = route<Params>(async ({ actor, params }) => deleteContact(actor, params.id), {
  permission: "contact:delete",
});
