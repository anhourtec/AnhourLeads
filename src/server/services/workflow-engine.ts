import "server-only";

import type { RecordEvent } from "./events";

/** Start workflow runs whose trigger matches the event. Implemented by the workflows package. */
export async function enqueueWorkflowRuns(_event: RecordEvent): Promise<void> {
  // No-op until implemented.
}
