import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { bulkMatchInput, bulkMatchPeople } from "@/server/services/enrichment";

/** Match up to 10 people in one call (`details[]`, each like /people/match). */
export const POST = route(
  async ({ req, actor, requestId }) => {
    const input = bulkMatchInput.parse(await readJson(req));
    return { request_id: requestId, ...(await bulkMatchPeople(actor, input)) };
  },
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
