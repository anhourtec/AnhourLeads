import { readJson, route } from "@/server/http/route";
import { deleteSnippet, getSnippet, updateSnippet } from "@/server/services/templates";

type P = { id: string };

export const GET = route<P>(async ({ actor, params }) => ({ snippet: await getSnippet(actor, params.id) }), {
  permission: "template:read",
});

export const PATCH = route<P>(
  async ({ req, actor, params }) => ({ snippet: await updateSnippet(actor, params.id, await readJson(req)) }),
  { permission: "template:update" },
);

/** Managers and up delete any snippet; members delete their own. */
export const DELETE = route<P>(
  async ({ actor, params }) => {
    await deleteSnippet(actor, params.id);
    return { deleted: true };
  },
  { permission: "template:create" },
);
