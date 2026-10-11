import { route } from "@/server/http/route";
import { discardMessage, messageDetail } from "@/server/services/emails";

type P = { id: string };

/** One message with its headers and timeline. */
export const GET = route<P>(async ({ actor, params }) => ({ emailer_message: await messageDetail(actor, params.id) }), {
  permission: "sequence:read",
});

/** Discard an unsent one-off email. */
export const DELETE = route<P>(
  async ({ actor, params }) => {
    await discardMessage(actor, params.id);
    return { deleted: true };
  },
  { permission: "sequence:launch" },
);
