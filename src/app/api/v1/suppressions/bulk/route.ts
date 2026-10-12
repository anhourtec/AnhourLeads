import { readJson, route } from "@/server/http/route";
import { bulkCreateSuppressions, suppressionBulkSchema } from "@/server/services/suppressions";

/** Add up to 1,000 emails or domains, one per line (`text`) or as `values`. */
export const POST = route(
  async ({ req, actor }) => bulkCreateSuppressions(actor, suppressionBulkSchema.parse(await readJson(req))),
  { permission: "suppression:create" },
);
