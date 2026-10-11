import { route } from "@/server/http/route";
import { deliverabilityOverview, mailboxSummary, overviewQuery } from "@/server/services/deliverability";

/** Mailbox performance (this month vs last), the daily chart, top sequences and recommendations. */
export const GET = route(
  async ({ req, actor }) => {
    const q = req.nextUrl.searchParams;
    const input = overviewQuery.parse({
      mailboxId: q.get("mailboxId") || undefined,
      days: q.get("days") || undefined,
    });
    const [overview, mailboxes] = await Promise.all([deliverabilityOverview(actor, input), mailboxSummary(actor)]);
    return { overview, mailboxes };
  },
  { permission: "deliverability:read" },
);
