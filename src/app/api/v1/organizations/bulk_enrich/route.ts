import { after } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { log } from "@/server/log";
import { bulkEnrichInput, bulkEnrichOrganizations } from "@/server/services/enrichment";
import { processCrawlJob } from "@/server/services/research";

/** Queue enrichment crawls for up to 10 organizations (`domains[]` or `details[]`). Poll the returned jobs. */
export const POST = route(
  async ({ req, actor }) => {
    const input = bulkEnrichInput.parse(await readJson(req));
    const { result, queued } = await bulkEnrichOrganizations(actor, input);
    if (queued.length) {
      after(async () => {
        for (const id of queued) {
          try {
            await processCrawlJob(id);
          } catch (error) {
            log.error("background crawl failed", { component: "crawler", jobId: id, error });
          }
        }
      });
    }
    return result;
  },
  { permission: "enrich:run", limit: LIMITS.sensitive },
);
