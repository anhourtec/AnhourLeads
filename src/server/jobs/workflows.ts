import "server-only";

import type { Job } from "./types";

/** Placeholder: implemented by the workflows package (scheduled triggers, delays, resumes). */
export const workflowsJob: Job = {
  name: "workflows",
  everySeconds: 60,
  run: async () => ({ processed: 0, note: "not implemented yet" }),
};
