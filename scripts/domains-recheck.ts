/**
 * Re-check workspace hostnames that are due, once, and exit. The scheduler runs the same job every
 * 5 minutes; this is for operators ("check now") and for platforms that prefer cron jobs.
 *
 *   npm run domains:recheck   # tsx --conditions=react-server scripts/domains-recheck.ts
 *
 * Pending hostnames are checked every 5 minutes until their claim expires (7 days), verified and
 * failing ones at most hourly; expired claims are removed. Safe to run while the scheduler runs:
 * every hostname is checked under its own Redis lock.
 */

import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

async function main() {
  const { domainsJob } = await import("../src/server/jobs/domains");
  const result = await domainsJob.run();
  console.log(`domains:recheck: ${result.note ?? `${result.processed} processed`}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("domains:recheck failed:", error.message);
    process.exit(1);
  });
