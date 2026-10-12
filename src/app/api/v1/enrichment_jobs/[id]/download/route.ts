import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { enrichmentJobCsv } from "@/server/services/enrichment-jobs";
import { csvResponse } from "@/server/services/records";

/** The job's results as CSV (the enriched rows of a CSV upload, or each record's outcome). */
export const GET = route<{ id: string }>(
  async ({ actor, params }) => {
    const { filename, csv } = await enrichmentJobCsv(actor, params.id);
    return csvResponse(filename, csv);
  },
  { permission: "contact:read", limit: LIMITS.sensitive },
);
