import { readJson, route } from "@/server/http/route";
import { deleteTemplate, getTemplate, updateTemplate } from "@/server/services/templates";

type P = { id: string };

export const GET = route<P>(async ({ actor, params }) => ({ email_template: await getTemplate(actor, params.id) }), {
  permission: "template:read",
});

export const PATCH = route<P>(
  async ({ req, actor, params }) => ({ email_template: await updateTemplate(actor, params.id, await readJson(req)) }),
  { permission: "template:update" },
);

/** Managers and up delete any template; members delete their own. */
export const DELETE = route<P>(
  async ({ actor, params }) => {
    await deleteTemplate(actor, params.id);
    return { deleted: true };
  },
  { permission: "template:create" },
);
