import { route } from "@/server/http/route";
import { emailAnalytics } from "@/server/services/emails";

/** Sent, delivered, bounced and replied per day and per mailbox (`days`, `mailboxId`). */
export const GET = route(
  async ({ req, actor }) => ({ analytics: await emailAnalytics(actor, Object.fromEntries(req.nextUrl.searchParams)) }),
  { permission: "sequence:read" },
);
