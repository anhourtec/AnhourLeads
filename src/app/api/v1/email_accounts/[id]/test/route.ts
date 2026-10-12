import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { testMailbox } from "@/server/services/mailboxes";

/** Connect to the mailbox's SMTP server and sign in, without sending anything. */
export const POST = route<{ id: string }>(async ({ actor, params }) => testMailbox(actor, params.id), {
  permission: "mailbox:update",
  limit: LIMITS.sensitive,
});
