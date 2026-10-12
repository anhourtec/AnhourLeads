import { route } from "@/server/http/route";
import { archiveSequence } from "@/server/services/sequences";

/** Archive: stop sending and finish every enrollment still in progress. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { sequence, steps } = await archiveSequence(actor, params.id);
    return { emailer_campaign: sequence, emailer_steps: steps };
  },
  { permission: "sequence:launch" },
);
