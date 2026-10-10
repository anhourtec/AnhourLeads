import { readJson, route } from "@/server/http/route";
import { deleteList, getList, updateList } from "@/server/services/lists";

type P = { id: string };

export const GET = route<P>(async ({ actor, params }) => ({ label: await getList(actor, params.id) }), {
  permission: "list:read",
});

/** Rename a list or change a dynamic list's filters. The record type is fixed. */
export const PATCH = route<P>(
  async ({ req, actor, params }) => ({ label: await updateList(actor, params.id, await readJson(req)) }),
  { permission: "list:update" },
);

/** Delete a list. Its records are kept. */
export const DELETE = route<P>(
  async ({ actor, params }) => {
    await deleteList(actor, params.id);
    return { deleted: true };
  },
  { permission: "list:delete" },
);
