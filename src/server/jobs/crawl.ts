import "server-only";

import type { Job } from "./types";

/** Placeholder: implemented by the crawl work package. */
export const crawlJob: Job = {
  name: "crawl",
  everySeconds: 300,
  run: async () => ({ processed: 0, note: "not implemented yet" }),
};
