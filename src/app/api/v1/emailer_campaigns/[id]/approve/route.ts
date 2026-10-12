import { route } from "@/server/http/route";
import { activateSequence } from "@/server/services/sequences";

/** Activate: needs at least one step and a mailbox with SMTP settings and a postal address. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { sequence, steps } = await activateSequence(actor, params.id);
    return { emailer_campaign: sequence, emailer_steps: steps };
  },
  { permission: "sequence:launch" },
);
