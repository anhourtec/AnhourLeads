import { route } from "@/server/http/route";
import { analyticsQueryInput, GROUP_BY_LABELS, queryAnalytics } from "@/server/services/analytics";
import { csvResponse, toCsv } from "@/server/services/records";

/**
 * One whitelisted metric over a date range, grouped by time or a dimension (rep, sequence, mailbox,
 * stage). Aggregated workspace data only. `format=csv` downloads the rows.
 */
export const GET = route(
  async ({ req, actor }) => {
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const query = analyticsQueryInput.parse({
      metric: params.metric,
      groupBy: params.groupBy || params.group_by || undefined,
      from: params.from || undefined,
      to: params.to || undefined,
      userId: params.userId || undefined,
      sequenceId: params.sequenceId || undefined,
      mailboxId: params.mailboxId || undefined,
    });
    const result = await queryAnalytics(actor, query);
    if (params.format === "csv") {
      const body = toCsv(
        [GROUP_BY_LABELS[result.groupBy], result.label],
        result.rows.map((r) => [r.label, r.value]),
      );
      return csvResponse(`${result.metric}-${result.groupBy}.csv`, body);
    }
    return { result };
  },
  { permission: "analytics:read" },
);
