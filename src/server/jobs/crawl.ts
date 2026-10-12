import "server-only";

import { log } from "@/server/log";
import { pendingCrawlJobIds, processCrawlJob } from "@/server/services/research";

import type { Job } from "./types";

/**
 * Picks up crawl jobs the request path didn't finish: queued jobs older than 20 seconds (the API
 * starts each job right after responding) and "running" jobs that went stale (process restarted).
 * The per-job Redis lock and conditional claim make concurrent runs safe.
 */
export const crawlJob: Job = {
  name: "crawl",
  everySeconds: 60,
  run: async () => {
    const ids = await pendingCrawlJobIds(5);
    let processed = 0;
    for (const id of ids) {
      try {
        const outcome = await processCrawlJob(id);
        if (outcome !== "skipped") processed += 1;
      } catch (error) {
        log.error("scheduled crawl failed", { component: "crawler", jobId: id, error });
      }
    }
    return { processed, note: ids.length ? `${ids.length} pending` : undefined };
  },
};
