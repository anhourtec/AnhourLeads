import { route } from "@/server/http/route";
import { getCrawlJob } from "@/server/services/research";

/** One crawl job with every page it fetched or skipped (and why) and its findings. */
export const GET = route<{ id: string }>(
  async ({ actor, params }) => {
    const detail = await getCrawlJob(actor, params.id);
    return { crawl_job: detail.job, pages: detail.pages, findings: detail.findings };
  },
  { permission: "crawler:read" },
);
