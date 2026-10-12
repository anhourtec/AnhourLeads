import "server-only";

import { recheckDue } from "@/server/domains/lifecycle";

import type { Job } from "./types";

/**
 * Hostname re-checks (docs/domains-and-ssl.md): pending hostnames every 5 minutes until their
 * claim expires after 7 days, verified / failing ones at most hourly; expired claims are removed.
 * Each hostname is checked under a Redis lock, so overlapping runs never double-check one.
 */
export const domainsJob: Job = {
  name: "domains",
  everySeconds: 300,
  run: async () => {
    const s = await recheckDue();
    return {
      processed: s.checked + s.expired,
      note: `checked ${s.checked} (verified ${s.verified}, not verified ${s.notVerified}), skipped ${s.skipped}, expired ${s.expired}`,
    };
  },
};
