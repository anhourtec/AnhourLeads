import { readJson, route } from "@/server/http/route";
import { deletePersona, getPersona, personaUpdateSchema, updatePersona } from "@/server/services/personas";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ persona: await getPersona(actor, params.id) }), {
  permission: "contact:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => {
    const input = personaUpdateSchema.parse(await readJson(req));
    return { persona: await updatePersona(actor, params.id, input) };
  },
  { permission: "persona:manage" },
);

/** Delete a persona; people tagged with it keep their data and lose the tag. */
export const DELETE = route<Params>(async ({ actor, params }) => deletePersona(actor, params.id), {
  permission: "persona:manage",
});
