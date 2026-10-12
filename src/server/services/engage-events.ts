import "server-only";

import type { RecordEvent } from "./events";

/**
 * Record an event from the engagement services. Loaded lazily: the event hub's handlers (workflows,
 * stage triggers) call back into sequences and tasks, so a static import would form a cycle.
 */
export async function emitEvent(event: RecordEvent): Promise<void> {
  const { recordEvent } = await import("./events");
  await recordEvent(event);
}
