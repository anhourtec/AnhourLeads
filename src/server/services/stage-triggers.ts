import "server-only";

import type { RecordEvent } from "./events";

/** Contact stage triggers (settings → contact stages → triggers). Implemented by the deals & stages package. */
export async function applyStageTriggers(_event: RecordEvent): Promise<void> {
  // No-op until implemented.
}
