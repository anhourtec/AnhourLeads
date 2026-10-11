import "server-only";

import { requeueDue } from "@/server/crawler/fleet/frontier";
import { deleteStalePeople } from "@/server/discovery/index-store";
import { dueSeedSources, runSeedSource } from "@/server/discovery/seeds";
import { getDiscoverySettings } from "@/server/discovery/settings";
import { log } from "@/server/log";
import { redis } from "@/server/redis";

import type { Job } from "./types";

/**
 * Discovery index upkeep (the crawler workers do the fetching): runs enabled seed sources whose
 * interval has passed, puts pages whose re-crawl time has come back in the queue, recovers URLs
 * claimed by a worker that died, and deletes people not seen for the retention period. A Redis
 * lock keeps two schedulers from running it at once.
 */
export const discoveryJob: Job = {
  name: "discovery",
  everySeconds: 300,
  run: async () => {
    const client = redis();
    const lockKey = "anhour:lock:discovery-job";
    try {
      if (client && (await client.set(lockKey, String(process.pid), "EX", 3_600, "NX")) !== "OK") {
        return { processed: 0, note: "another run holds the lock" };
      }
    } catch {
      // Redis is optional; run without the lock.
    }
    try {
      let processed = 0;
      for (const source of await dueSeedSources()) {
        try {
          await runSeedSource(source.id);
          processed += 1;
        } catch (error) {
          log.error("seed source failed", { component: "discovery", sourceId: source.id, error });
        }
      }
      const { requeued, recovered } = await requeueDue();
      const settings = await getDiscoverySettings();
      const deleted = await deleteStalePeople(settings.retentionDays);
      return {
        processed: processed + requeued + recovered + deleted,
        note: `sources ${processed}, requeued ${requeued}, recovered ${recovered}, people deleted ${deleted}`,
      };
    } finally {
      try {
        await client?.del(lockKey);
      } catch {
        // Expires on its own.
      }
    }
  },
};
