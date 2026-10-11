import "server-only";

import type { Job } from "./types";

/** Placeholder: implemented by the data package (queued enrichment jobs, domain DNS re-checks). */
export const enrichmentJob: Job = {
  name: "enrichment",
  everySeconds: 120,
  run: async () => ({ processed: 0, note: "not implemented yet" }),
};
