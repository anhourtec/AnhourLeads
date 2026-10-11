import { readJson, route } from "@/server/http/route";
import {
  customFieldUpdateSchema,
  deleteCustomField,
  getCustomField,
  updateCustomField,
} from "@/server/services/custom-fields";

type Params = { id: string };

export const GET = route<Params>(
  async ({ actor, params }) => ({ custom_field: await getCustomField(actor, params.id) }),
  {
    permission: "contact:read",
  },
);

/** Rename, reorder or change a picklist's options. The type can't change. */
export const PATCH = route<Params>(
  async ({ req, actor, params }) => {
    const input = customFieldUpdateSchema.parse(await readJson(req));
    return { custom_field: await updateCustomField(actor, params.id, input) };
  },
  { permission: "customfield:manage" },
);

/** Delete the field and its stored values. */
export const DELETE = route<Params>(async ({ actor, params }) => deleteCustomField(actor, params.id), {
  permission: "customfield:manage",
});
