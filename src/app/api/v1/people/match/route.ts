import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { matchPerson, personMatchInput } from "@/server/services/enrichment";

/** Match and enrich one person: find their email from the company's pattern and verify it. */
export const POST = route(
  async ({ req, actor, requestId }) => {
    const input = personMatchInput.parse(await readJson(req));
    return { request_id: requestId, ...(await matchPerson(actor, input)) };
  },
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
