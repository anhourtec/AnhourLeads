/** A scheduled job run by the scheduler container (scripts/scheduler.ts). */
export interface Job {
  name: string;
  /** How often to run, in seconds. */
  everySeconds: number;
  /** Do one pass. Must be safe to run concurrently with the app and idempotent. */
  run: () => Promise<{ processed: number; note?: string }>;
}
