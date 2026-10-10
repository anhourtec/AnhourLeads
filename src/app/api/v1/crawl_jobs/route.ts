import { after, NextResponse } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { log } from "@/server/log";
import {
  createCrawlJob,
  createCrawlJobInput,
  listCrawlJobs,
  listCrawlJobsQuery,
  processCrawlJob,
} from "@/server/services/research";

/** List the workspace's crawl jobs, newest first. Filters: `status`, `companyId`. */
export const GET = route(
  async ({ req, actor }) => {
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = listCrawlJobsQuery.parse({
      status: params.status || undefined,
      companyId: params.companyId || undefined,
    });
    const page = pageFrom(params);
    const { jobs, total } = await listCrawlJobs(actor, page, filters);
    return { crawl_jobs: jobs, pagination: pagination(page, total) };
  },
  { permission: "crawler:read" },
);

/** Queue a crawl of a website (`url`) or a company's website (`companyId`). Runs in the background. */
export const POST = route(
  async ({ req, actor }) => {
    const input = createCrawlJobInput.parse(await readJson(req));
    const job = await createCrawlJob(actor, input);
    after(async () => {
      try {
        await processCrawlJob(job.id);
      } catch (error) {
        log.error("background crawl failed", { component: "crawler", jobId: job.id, error });
      }
    });
    return NextResponse.json({ crawl_job: job }, { status: 201 });
  },
  { permission: "crawler:run", limit: LIMITS.sensitive },
);
