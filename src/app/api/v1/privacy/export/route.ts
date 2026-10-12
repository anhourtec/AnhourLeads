import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { exportByEmail, privacyEmailSchema } from "@/server/services/privacy";

/** Access request: everything held about an email address in this workspace, as JSON. */
export const GET = route(
  async ({ req, actor }) => {
    const { email } = privacyEmailSchema.parse({ email: req.nextUrl.searchParams.get("email") ?? "" });
    return exportByEmail(actor, email);
  },
  { permission: "contact:export", limit: LIMITS.sensitive },
);
