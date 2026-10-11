import { readJson, route } from "@/server/http/route";
import {
  deleteSavedSearch,
  getSavedSearch,
  savedSearchUpdateSchema,
  updateSavedSearch,
} from "@/server/services/saved-searches";

type Params = { id: string };

export const GET = route<Params>(
  async ({ actor, params }) => ({ saved_search: await getSavedSearch(actor, params.id) }),
  {
    permission: "search:run",
  },
);

/** The owner edits anything; anyone who can see the search may only star or unstar it. */
export const PATCH = route<Params>(
  async ({ req, actor, params }) => {
    const input = savedSearchUpdateSchema.parse(await readJson(req));
    return { saved_search: await updateSavedSearch(actor, params.id, input) };
  },
  { permission: "savedsearch:create" },
);

export const DELETE = route<Params>(async ({ actor, params }) => deleteSavedSearch(actor, params.id), {
  permission: "savedsearch:create",
});
