import { pageFrom, pagination, route } from "@/server/http/route";
import { searchMessages } from "@/server/services/sending";

/** Outbound messages: sent, queued, held for review, blocked or failed. */
export const GET = route(
  async ({ req, actor }) => {
    const search = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(search);
    const { messages, total } = await searchMessages(
      actor,
      { status: search.status || undefined, sequenceId: search.sequenceId || undefined },
      page,
    );
    return { emailer_messages: messages, pagination: pagination(page, total) };
  },
  { permission: "sequence:read" },
);
