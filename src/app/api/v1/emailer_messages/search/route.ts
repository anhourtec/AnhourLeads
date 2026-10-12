import { pageFrom, pagination, route } from "@/server/http/route";
import { messageGroupCounts, searchMessages } from "@/server/services/emails";

/**
 * Outbound messages: sent, queued, held for review, blocked or failed. Filters: status, group
 * (scheduled, delivered, replied, bounced, not_sent, failed), sequenceId, mailboxId, contactId,
 * oneOff, q. Pass counts=true for per-group counts.
 */
export const GET = route(
  async ({ req, actor }) => {
    const search = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(search);
    const filters = {
      status: search.status || undefined,
      group: search.group || undefined,
      sequenceId: search.sequenceId || undefined,
      mailboxId: search.mailboxId || undefined,
      contactId: search.contactId || undefined,
      oneOff: search.oneOff || undefined,
      q: search.q || undefined,
    };
    const { messages, total } = await searchMessages(actor, filters, page);
    const counts = search.counts === "true" ? await messageGroupCounts(actor, filters) : undefined;
    return { emailer_messages: messages, pagination: pagination(page, total), ...(counts ? { counts } : {}) };
  },
  { permission: "sequence:read" },
);
