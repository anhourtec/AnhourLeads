import { route } from "@/server/http/route";
import { getEnrichmentJob } from "@/server/services/enrichment-jobs";

/** One job with its results: CSV rows (500 per `rows_page`) or record outcomes. */
export const GET = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const rowsPage = Number.parseInt(req.nextUrl.searchParams.get("rows_page") ?? "1", 10) || 1;
    const detail = await getEnrichmentJob(actor, params.id, rowsPage);
    return {
      enrichment_job: detail.job,
      rows: detail.rows,
      rows_total: detail.rowsTotal,
      rows_per_page: detail.rowsPerPage,
      outcomes: detail.outcomes,
    };
  },
  { permission: "contact:read" },
);
