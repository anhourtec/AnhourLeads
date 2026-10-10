import { readJson, route } from "@/server/http/route";
import { removeMembers } from "@/server/services/lists";

/** Remove records from a static list. The records themselves are kept. */
export const POST = route(async ({ req, actor }) => removeMembers(actor, await readJson(req)), {
  permission: "list:update",
});
