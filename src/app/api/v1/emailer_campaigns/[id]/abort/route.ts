import { route } from "@/server/http/route";
import { pauseSequence } from "@/server/services/sequences";

/** Pause sending. Enrollments keep their place and continue when the sequence is activated again. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { sequence, steps } = await pauseSequence(actor, params.id);
    return { emailer_campaign: sequence, emailer_steps: steps };
  },
  { permission: "sequence:launch" },
);
