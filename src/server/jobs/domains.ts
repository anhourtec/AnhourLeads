import "server-only";

import type { Job } from "./types";

/** Placeholder: implemented by the domains work package. */
export const domainsJob: Job = {
  name: "domains",
  everySeconds: 300,
  run: async () => ({ processed: 0, note: "not implemented yet" }),
};
