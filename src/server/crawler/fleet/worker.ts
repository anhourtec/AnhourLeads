import "server-only";

import { fleetConfig } from "@/server/discovery/config";
import { pipelineToggles } from "@/server/discovery/seeds";
import { getDiscoverySettings } from "@/server/discovery/settings";
import { log } from "@/server/log";
import { redis } from "@/server/redis";

import { claimNext, nextDueAt, settle } from "./frontier";
import { type PipelineToggles, processClaim } from "./process";
import { hostname } from "node:os";

/**
 * The crawler fleet's work loop. Each worker process runs CRAWLER_CONCURRENCY lanes; each lane
 * claims one URL at a time (frontier.claimNext), processes it and settles it. Workers announce
 * themselves in Redis (a key with a 90 s expiry) so the platform screen can list them.
 */

export const WORKER_KEY_PREFIX = "anhour:crawler:worker:";

export interface ProcessedRow {
  url: string;
  kind: string;
  host: string;
  outcome: string;
  reason: string | null;
  statusCode: number | null;
  stats: Record<string, number | undefined>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Context {
  toggles: PipelineToggles;
  recrawlDays: Awaited<ReturnType<typeof getDiscoverySettings>>["recrawlDays"];
  loadedAt: number;
}

async function loadContext(): Promise<Context> {
  const [toggles, settings] = await Promise.all([pipelineToggles(), getDiscoverySettings()]);
  return { toggles, recrawlDays: settings.recrawlDays, loadedAt: Date.now() };
}

/** Claim, process and settle one URL. Null when nothing could be claimed. */
async function step(ctx: Context, hosts?: string[]): Promise<ProcessedRow | null> {
  const claim = await claimNext({ hosts });
  if (!claim) return null;
  let result: Awaited<ReturnType<typeof processClaim>>;
  try {
    result = await processClaim(claim, ctx.toggles);
  } catch (error) {
    log.error("crawl step failed", { component: "crawler-fleet", url: claim.row.url, error });
    result = { outcome: { type: "retry", reason: "worker_error", statusCode: null }, stats: {} };
  }
  await settle(claim, result.outcome, ctx.recrawlDays);
  const o = result.outcome;
  const row: ProcessedRow = {
    url: claim.row.url,
    kind: claim.row.kind,
    host: claim.row.host,
    outcome: o.type,
    reason: o.type === "done" ? null : o.reason,
    statusCode: o.statusCode ?? null,
    stats: result.stats,
  };
  log.info("crawled", { component: "crawler-fleet", ...row });
  return row;
}

/**
 * Process up to `max` URLs synchronously (platform run_once endpoint: tests and debugging).
 * Waits for per-host politeness windows instead of skipping them, within `budgetMs`.
 */
export async function runOnce(options: { max: number; hosts?: string[]; budgetMs?: number }): Promise<ProcessedRow[]> {
  const deadline = Date.now() + (options.budgetMs ?? 90_000);
  const ctx = await loadContext();
  const out: ProcessedRow[] = [];
  while (out.length < options.max && Date.now() < deadline) {
    const row = await step(ctx, options.hosts);
    if (row) {
      out.push(row);
      continue;
    }
    const due = await nextDueAt(options.hosts);
    if (!due) break;
    const wait = due.getTime() - Date.now();
    if (wait > deadline - Date.now()) break;
    await sleep(Math.max(100, wait + 50));
  }
  return out;
}

export interface WorkerHandle {
  id: string;
  stop: () => Promise<void>;
}

/** Start a long-running worker (scripts/crawler-worker.ts). */
export function startWorker(options: { onBeat?: () => void } = {}): WorkerHandle {
  const config = fleetConfig();
  const id = `${hostname()}:${process.pid}`;
  const logger = log.child({ component: "crawler-fleet", worker: id });
  const startedAt = new Date().toISOString();
  let stopping = false;
  let processed = 0;
  let ctx: Context | null = null;

  const beat = async () => {
    options.onBeat?.();
    try {
      await redis()?.set(
        `${WORKER_KEY_PREFIX}${id}`,
        JSON.stringify({
          id,
          startedAt,
          lastBeatAt: new Date().toISOString(),
          processed,
          concurrency: config.concurrency,
        }),
        "EX",
        90,
      );
    } catch {
      // Redis is optional; the heartbeat file still works.
    }
  };
  void beat();
  const beatTimer = setInterval(() => void beat(), 15_000);

  const lane = async (n: number) => {
    // Stagger lanes so they don't all hit the database at once.
    await sleep(n * 250);
    while (!stopping) {
      try {
        if (!ctx || Date.now() - ctx.loadedAt > 60_000) ctx = await loadContext();
        const row = await step(ctx);
        if (row) processed += 1;
        else await sleep(2_000);
      } catch (error) {
        logger.error("lane error", { lane: n, error });
        await sleep(5_000);
      }
    }
  };
  const lanes = Array.from({ length: config.concurrency }, (_, n) => lane(n));
  logger.info("crawler worker started", { concurrency: config.concurrency, userAgent: config.userAgent });

  return {
    id,
    stop: async () => {
      stopping = true;
      clearInterval(beatTimer);
      await Promise.race([Promise.allSettled(lanes), sleep(30_000)]);
      try {
        await redis()?.del(`${WORKER_KEY_PREFIX}${id}`);
      } catch {
        // Expires on its own.
      }
      logger.info("crawler worker stopped", { processed });
    },
  };
}
