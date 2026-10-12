import "server-only";

import { runDueSequences } from "@/server/services/sending";

import type { Job } from "./types";

/**
 * Sequence sender: for each active sequence, sends approved messages and runs due steps inside each
 * mailbox's sending window and daily limit. A Redis lock per sequence keeps concurrent schedulers
 * from sending the same step twice; per-step message records make re-runs idempotent.
 */
export const sequencesJob: Job = {
  name: "sequences",
  everySeconds: 60,
  run: runDueSequences,
};
