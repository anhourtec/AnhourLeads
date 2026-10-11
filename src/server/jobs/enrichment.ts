import "server-only";

import { log } from "@/server/log";
import { pendingEnrichmentJobIds, processEnrichmentJob, runDueAutomations } from "@/server/services/enrichment-jobs";
import { recheckStaleSendingDomains } from "@/server/services/sending-domains";

import type { Job } from "./types";

/**
 * Enrichment worker: starts due automation schedules (re-verify old emails, re-crawl old companies),
 * processes queued enrichment jobs the request path didn't finish (and "running" ones left behind
 * by a restart), then re-checks the DNS of stale sending domains. Locks and conditional claims in
 * the services make overlapping runs safe.
 */
export const enrichmentJob: Job = {
  name: "enrichment",
  everySeconds: 120,
  run: async () => {
    let spawned = 0;
    try {
      spawned = await runDueAutomations();
    } catch (error) {
      log.error("enrichment automation failed", { component: "enrichment", error });
    }
    const ids = await pendingEnrichmentJobIds(3);
    let processed = 0;
    for (const id of ids) {
      try {
        if ((await processEnrichmentJob(id)) !== "skipped") processed += 1;
      } catch (error) {
        log.error("scheduled enrichment job failed", { component: "enrichment", jobId: id, error });
      }
    }
    let domains = 0;
    try {
      domains = (await recheckStaleSendingDomains(10)).checked;
    } catch (error) {
      log.error("sending domain re-check failed", { component: "enrichment", error });
    }
    return { processed, note: `jobs ${ids.length} pending, ${spawned} scheduled, ${domains} domains re-checked` };
  },
};
