import { readJson, route } from "@/server/http/route";
import { addMembers } from "@/server/services/lists";

/** Add contacts or companies (matching the list's record type) to a static list, by list id. */
export const POST = route(async ({ req, actor }) => addMembers(actor, await readJson(req)), {
  permission: "list:update",
});
