import { readJson, route } from "@/server/http/route";
import { removeOrStopContacts } from "@/server/services/sequences";

/** Remove, stop (pause) or finish contacts in one or more sequences. */
export const POST = route(async ({ req, actor }) => removeOrStopContacts(actor, await readJson(req)), {
  permission: "sequence:launch",
});
