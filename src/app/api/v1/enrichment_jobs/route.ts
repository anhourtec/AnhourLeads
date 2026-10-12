import { after, type NextRequest, NextResponse } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { log } from "@/server/log";
import {
  createEnrichmentJob,
  createJobInput,
  listEnrichmentJobs,
  listJobsQuery,
  processEnrichmentJob,
} from "@/server/services/enrichment-jobs";
import { IMPORT_MAX_BYTES, unprocessable } from "@/server/services/records";

/** Enrichment jobs, newest first. Filters: `status`, `kind`. */
export const GET = route(
  async ({ req, actor }) => {
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = listJobsQuery.parse({ status: params.status || undefined, kind: params.kind || undefined });
    const page = pageFrom(params);
    const { jobs, total } = await listEnrichmentJobs(actor, page, filters);
    return { enrichment_jobs: jobs, pagination: pagination(page, total) };
  },
  { permission: "contact:read" },
);

/** JSON body, or multipart/form-data with `file` (+ `saveToRecords`) for a CSV upload. */
async function readBody(req: NextRequest): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) return readJson(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw unprocessable("Attach a CSV file in the `file` field.", "csv");
  if (file.size > IMPORT_MAX_BYTES * 2) throw unprocessable("The file is larger than 10 MB.", "csv");
  return {
    kind: "csv",
    fileName: file.name || undefined,
    csv: await file.text(),
    saveToRecords: form.get("saveToRecords") === "true",
  };
}

/**
 * Queue an enrichment job: `kind: "csv"` (a CSV of people, up to 10,000 rows), `kind: "records"`
 * (contact / company ids, or a health `segment`) or `kind: "list"`. Processing starts right after
 * the response; poll GET /enrichment_jobs/{id}.
 */
export const POST = route(
  async ({ req, actor }) => {
    const input = createJobInput.parse(await readBody(req));
    const job = await createEnrichmentJob(actor, input);
    after(async () => {
      try {
        await processEnrichmentJob(job.id);
      } catch (error) {
        log.error("background enrichment failed", { component: "enrichment", jobId: job.id, error });
      }
    });
    return NextResponse.json({ enrichment_job: job }, { status: 201 });
  },
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
