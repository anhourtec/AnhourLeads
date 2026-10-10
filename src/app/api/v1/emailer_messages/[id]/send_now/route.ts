import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { sendMessageNow } from "@/server/services/sending";

/** Send a held, queued or failed message immediately. Compliance checks and the daily limit still apply. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { message } = await sendMessageNow(actor, params.id);
    return { emailer_message: message };
  },
  { permission: "sequence:launch", limit: LIMITS.sensitive },
);
