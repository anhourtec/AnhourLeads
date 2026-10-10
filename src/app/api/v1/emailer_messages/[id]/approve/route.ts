import { route } from "@/server/http/route";
import { approveMessage } from "@/server/services/sending";

/** Approve a message held for review; the engine sends it inside the mailbox's sending window. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { message } = await approveMessage(actor, params.id);
    return { emailer_message: message };
  },
  { permission: "sequence:launch" },
);
