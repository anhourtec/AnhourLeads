import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { accessEmailInput, accessIndexEmail } from "@/server/services/discovery";

/**
 * "Access email" for an index person: saves them to the workspace when needed (contact:create),
 * then finds and verifies the address with the workspace's own people match (enrich:run).
 */
export const POST = route(
  async ({ req, actor }) => {
    const { id } = accessEmailInput.parse(await readJson(req));
    return accessIndexEmail(actor, id);
  },
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
