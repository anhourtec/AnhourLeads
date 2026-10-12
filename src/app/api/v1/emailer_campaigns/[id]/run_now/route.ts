import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { runSequence } from "@/server/services/sending";
import { findSequence } from "@/server/services/sequences";

/** Run the sending engine for this one sequence now, instead of waiting for the scheduler. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const sequence = await findSequence(actor, params.id);
    return { run: await runSequence(sequence.id) };
  },
  { permission: "sequence:launch", limit: LIMITS.sensitive },
);
