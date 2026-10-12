/**
 * Crawler fleet worker: builds the installation-wide discovery index from public sources.
 * Runs in the `crawler` container (same image as the app); scale with
 * `docker compose up -d --scale crawler=N`. Any number of workers can run on any number of
 * machines against the same Postgres: URLs are claimed with FOR UPDATE SKIP LOCKED and each host
 * has at most one request in flight. See docs/data-pipeline.md.
 *
 *   tsx --conditions=react-server scripts/crawler-worker.ts
 *
 * Environment: the app's settings (DATABASE_URL, REDIS_URL, CRAWLER_USER_AGENT…) plus
 * CRAWLER_CONCURRENCY (default 4), CRAWLER_MAX_PAGES_PER_HOST (25), CRAWLER_MIN_DELAY_MS (2000,
 * also the floor), CRAWLER_HOST_ERROR_LIMIT (8), CRAWLER_MAX_ATTEMPTS (5), CRAWLER_CONTACT_URL and
 * CRAWLER_HEARTBEAT_FILE (default /tmp/crawler-heartbeat, touched every 15 s for the healthcheck).
 * Stops cleanly on SIGTERM / SIGINT: no new URLs are claimed and in-flight pages finish (≤ 30 s).
 */

import { existsSync, writeFileSync } from "node:fs";

// Local runs read .env; in containers the environment comes from compose.
if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

const HEARTBEAT_FILE = process.env.CRAWLER_HEARTBEAT_FILE ?? "/tmp/crawler-heartbeat";

async function main() {
  const [{ log }, { startWorker }] = await Promise.all([
    import("../src/server/log"),
    import("../src/server/crawler/fleet/worker"),
  ]);
  const logger = log.child({ component: "crawler-worker" });

  const heartbeat = () => {
    try {
      writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
    } catch (error) {
      logger.warn("heartbeat write failed", { error });
    }
  };
  heartbeat();
  const worker = startWorker({ onBeat: heartbeat });
  process.stdout.write(`crawler worker ${worker.id} running (heartbeat ${HEARTBEAT_FILE})\n`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("crawler worker stopping", { signal });
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: Error) => {
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), level: "error", msg: "crawler worker crashed", component: "crawler-worker", error: error.message })}\n`,
  );
  process.exit(1);
});
