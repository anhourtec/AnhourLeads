import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { runDue } from "@/server/services/workflows";

type Params = { id: string };

/** Process this workflow's due schedule and waiting runs now (what the scheduler does every minute). */
export const POST = route<Params>(async ({ actor, params }) => ({ processed: await runDue(actor, params.id) }), {
  permission: "workflow:launch",
  limit: LIMITS.sensitive,
});
