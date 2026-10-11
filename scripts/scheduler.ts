/**
 * Background jobs for production: runs in the `scheduler` container (same image as the app).
 *
 *   npm run scheduler        # tsx --conditions=react-server scripts/scheduler.ts
 *
 * Runs every job in src/server/jobs/registry.ts on its own interval (`everySeconds`). A job never
 * overlaps with itself; different jobs run side by side. Each run is logged as JSON (start, finish
 * with processed count and duration, or failure). A run that takes longer than its timeout is
 * logged as stuck (it isn't killed: jobs are idempotent and hold their own locks).
 *
 * Touches a heartbeat file every 30 s for the container healthcheck (SCHEDULER_HEARTBEAT_FILE,
 * default /tmp/scheduler-heartbeat). Stops cleanly on SIGTERM / SIGINT: no new runs start and
 * running ones are awaited (up to 60 s).
 *
 * Environment: the app's own settings, plus SCHEDULER_JOBS (comma-separated names to run; default all;
 * only the listed jobs' modules are loaded)
 * and SCHEDULER_DRY_RUN=true (log the plan and exit).
 */

import type { Job } from "../src/server/jobs/types";
import { existsSync, writeFileSync } from "node:fs";

// Local runs read .env; in containers the environment comes from compose.
if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

const HEARTBEAT_FILE = process.env.SCHEDULER_HEARTBEAT_FILE ?? "/tmp/scheduler-heartbeat";
const TICK_MS = 5_000;
const FIRST_RUN_DELAY_MS = 15_000;
const SHUTDOWN_WAIT_MS = 60_000;

/**
 * One loader per job, so SCHEDULER_JOBS imports only the modules it needs: a job whose import chain
 * fails outside Next (e.g. a service importing next/navigation) can't take the others down.
 */
const JOB_LOADERS: Record<string, () => Promise<Job>> = {
  domains: () => import("../src/server/jobs/domains").then((m) => m.domainsJob),
  crawl: () => import("../src/server/jobs/crawl").then((m) => m.crawlJob),
  sequences: () => import("../src/server/jobs/sequences").then((m) => m.sequencesJob),
  workflows: () => import("../src/server/jobs/workflows").then((m) => m.workflowsJob),
  enrichment: () => import("../src/server/jobs/enrichment").then((m) => m.enrichmentJob),
  discovery: () => import("../src/server/jobs/discovery").then((m) => m.discoveryJob),
};

async function main() {
  const { log } = await import("../src/server/log");
  const logger = log.child({ component: "scheduler" });

  const only = (process.env.SCHEDULER_JOBS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = only.filter((name) => !JOB_LOADERS[name]);
  if (unknown.length) logger.warn("unknown jobs in SCHEDULER_JOBS", { unknown });
  const jobs: Job[] = only.length
    ? await Promise.all(only.filter((name) => JOB_LOADERS[name]).map((name) => JOB_LOADERS[name]()))
    : (await import("../src/server/jobs/registry")).JOBS;
  logger.info("scheduler started", { jobs: jobs.map((j) => ({ job: j.name, everySeconds: j.everySeconds })) });
  if (process.env.SCHEDULER_DRY_RUN === "true") process.exit(0);

  const heartbeat = () => {
    try {
      writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
    } catch (error) {
      logger.warn("heartbeat write failed", { error });
    }
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 30_000);

  const nextAt = new Map(jobs.map((j) => [j.name, Date.now() + FIRST_RUN_DELAY_MS]));
  const running = new Map<string, Promise<void>>();
  let stopping = false;

  const runJob = async (job: (typeof jobs)[number]) => {
    const started = performance.now();
    const timeoutMs = Math.max(job.everySeconds * 4, 600) * 1000;
    const stuck = setTimeout(
      () => logger.error("job is taking unusually long", { job: job.name, timeoutMs }),
      timeoutMs,
    );
    logger.info("job started", { job: job.name });
    try {
      const result = await job.run();
      logger.info("job finished", {
        job: job.name,
        processed: result.processed,
        note: result.note,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      logger.error("job failed", { job: job.name, durationMs: Math.round(performance.now() - started), error });
    } finally {
      clearTimeout(stuck);
    }
  };

  const tick = () => {
    if (stopping) return;
    const now = Date.now();
    for (const job of jobs) {
      if (running.has(job.name) || (nextAt.get(job.name) ?? 0) > now) continue;
      nextAt.set(job.name, now + job.everySeconds * 1000);
      const run = runJob(job).finally(() => running.delete(job.name));
      running.set(job.name, run);
    }
  };
  const tickTimer = setInterval(tick, TICK_MS);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(tickTimer);
    logger.info("scheduler stopping", { signal, running: [...running.keys()] });
    const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS));
    await Promise.race([Promise.allSettled(running.values()), timeout]);
    clearInterval(heartbeatTimer);
    logger.info("scheduler stopped", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: Error) => {
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), level: "error", msg: "scheduler crashed", component: "scheduler", error: error.message })}\n`,
  );
  process.exit(1);
});
