import "server-only";

import type { Job } from "./types";

/** Placeholder: implemented by the sequences work package. */
export const sequencesJob: Job = {
  name: "sequences",
  everySeconds: 300,
  run: async () => ({ processed: 0, note: "not implemented yet" }),
};
