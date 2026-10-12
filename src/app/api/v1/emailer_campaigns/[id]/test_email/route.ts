import type { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { sendTestEmail } from "@/server/services/emails";

/** Send the step as written to your own email address, from the sequence's mailbox. */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => sendTestEmail(actor, params.id, await readJson(req)),
  { permission: "sequence:update", limit: { max: 10, window: 600 } satisfies typeof LIMITS.sensitive },
);
