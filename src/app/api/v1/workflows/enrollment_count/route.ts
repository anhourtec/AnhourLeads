import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { enrollmentCount, enrollmentCountSchema } from "@/server/services/workflows";

/** How many records match enrollment criteria right now ("pre-qualified"). */
export const POST = route(
  async ({ req, actor }) => enrollmentCount(actor, enrollmentCountSchema.parse(await readJson(req))),
  {
    permission: "workflow:read",
    limit: LIMITS.read,
  },
);
