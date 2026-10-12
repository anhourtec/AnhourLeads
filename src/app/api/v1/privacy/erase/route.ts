import { requirePermission } from "@/server/auth/actor";
import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { eraseByEmail, privacyEmailSchema } from "@/server/services/privacy";

/** Erasure request: delete everything held about an email and keep it on the do-not-contact list. */
export const POST = route(
  async ({ req, actor }) => {
    requirePermission(actor, "suppression:create");
    const { email } = privacyEmailSchema.parse(await readJson(req));
    const { deleted } = await eraseByEmail(actor, email);
    return { erased: true, deleted };
  },
  { permission: "contact:delete", limit: LIMITS.sensitive },
);
