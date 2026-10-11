import { pageFrom, pagination, route } from "@/server/http/route";
import { bounceLogQuery, bounceLogs } from "@/server/services/sending-policy";

/** Bounced and blocked messages, newest first. Filters: `status` (bounced | blocked | all), `policyOnly`. */
export const GET = route(
  async ({ req, actor }) => {
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const query = bounceLogQuery.parse({ status: params.status || undefined, policyOnly: params.policyOnly });
    const page = pageFrom(params);
    const { entries, total } = await bounceLogs(actor, query, page);
    return { bounce_logs: entries, pagination: pagination(page, total) };
  },
  { permission: "deliverability:read" },
);
