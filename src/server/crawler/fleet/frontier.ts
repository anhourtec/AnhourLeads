import "server-only";

import { and, count, eq, gt, inArray, or, sql } from "drizzle-orm";

import { db, schema } from "@/server/db";
import {
  backoffMs,
  bareDomain,
  type FrontierKind,
  hostKey,
  KIND_PRIORITY,
  RESERVED_HOST_PATTERN,
  recrawlIntervalMs,
} from "@/server/discovery/classify";
import { fleetConfig } from "@/server/discovery/config";
import { isDeniedUrl } from "@/server/discovery/denylist";
import { isOptedOut } from "@/server/discovery/optouts";

import { normalizeUrl } from "../url";

/**
 * The URL frontier shared by every crawler worker (crawl_frontier + crawl_host in Postgres).
 *
 * Claiming takes the least recently used host whose politeness window has passed, locks that
 * host row with `FOR UPDATE SKIP LOCKED`, picks its best due URL and reserves both with a lease,
 * all in one transaction. So any number of workers on any number of machines can claim in
 * parallel, and a host never has more than one request in flight.
 */

export type FrontierRow = typeof schema.crawlFrontier.$inferSelect;
export type HostRow = typeof schema.crawlHost.$inferSelect;

export interface EnqueueItem {
  url: string;
  kind: FrontierKind;
  priority?: number;
  depth?: number;
  discoveredFrom?: string | null;
}

export interface EnqueueResult {
  queued: number;
  requeued: number;
  skipped: number;
  existing: number;
}

/**
 * Add URLs to the frontier. Deny-listed hosts are recorded as skipped ("denylist") and opted-out
 * domains as skipped ("opted_out"), so an operator can see why they were never fetched.
 * `refresh` makes already-crawled URLs due again (seed re-runs); `capPerHost` stops one site from
 * flooding the queue with discovered links.
 */
export async function enqueue(
  items: EnqueueItem[],
  options: { refresh?: boolean; capPerHost?: boolean } = {},
): Promise<EnqueueResult> {
  const result: EnqueueResult = { queued: 0, requeued: 0, skipped: 0, existing: 0 };
  const config = fleetConfig();
  const budget = new Map<string, number>();
  for (const item of items) {
    const url = normalizeUrl(item.url);
    if (!url) continue;
    const href = url.toString();
    const host = hostKey(url);
    let status: "queued" | "skipped" = "queued";
    let skippedReason: string | null = null;
    if (isDeniedUrl(url)) {
      status = "skipped";
      skippedReason = "denylist";
    } else if (await isOptedOut({ domain: bareDomain(url.hostname) })) {
      status = "skipped";
      skippedReason = "opted_out";
    }
    if (status === "queued" && options.capPerHost) {
      let left = budget.get(host);
      if (left === undefined) {
        const [row] = await db
          .select({ n: count() })
          .from(schema.crawlFrontier)
          .where(
            and(
              eq(schema.crawlFrontier.host, host),
              or(
                inArray(schema.crawlFrontier.status, ["queued", "fetching"]),
                gt(schema.crawlFrontier.fetchedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
              ),
            ),
          );
        left = config.maxPagesPerHost - Number(row?.n ?? 0);
      }
      if (left <= 0) {
        budget.set(host, 0);
        continue;
      }
      budget.set(host, left - 1);
    }
    if (status === "queued") {
      await db.insert(schema.crawlHost).values({ host, crawlDelayMs: config.minDelayMs }).onConflictDoNothing();
    }
    const inserted = await db
      .insert(schema.crawlFrontier)
      .values({
        url: href,
        host,
        kind: item.kind,
        priority: item.priority ?? KIND_PRIORITY[item.kind],
        depth: item.depth ?? 0,
        status,
        skippedReason,
        discoveredFrom: item.discoveredFrom ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.crawlFrontier.id });
    if (inserted.length) {
      if (status === "queued") result.queued += 1;
      else result.skipped += 1;
      continue;
    }
    if (status === "skipped") {
      result.skipped += 1;
      continue;
    }
    if (options.refresh) {
      const updated = await db
        .update(schema.crawlFrontier)
        .set({ status: "queued", nextAttemptAt: new Date(), attempts: 0, skippedReason: null })
        .where(and(eq(schema.crawlFrontier.url, href), inArray(schema.crawlFrontier.status, ["done", "failed"])))
        .returning({ id: schema.crawlFrontier.id });
      if (updated.length) {
        result.requeued += 1;
        continue;
      }
    }
    result.existing += 1;
  }
  return result;
}

export interface Claim {
  row: FrontierRow;
  host: HostRow;
}

type ClaimedRow = { id: string };

/**
 * Claim one due URL on a host that may be fetched now, or null. `hosts` restricts the claim (the
 * synchronous run_once endpoint uses it so tests only touch their own fixture hosts).
 */
export async function claimNext(options: { hosts?: string[] } = {}): Promise<Claim | null> {
  const { leaseMs } = fleetConfig();
  // Without an explicit host list (the long-running workers), never claim local fixture hosts:
  // reserved names (RFC 6761 / 2606) and loopback addresses are never real public sites, and the
  // test harness drives them itself through run_once.
  const hostFilter = options.hosts?.length
    ? sql`and h.host in (${sql.join(
        options.hosts.map((h) => sql`${h}`),
        sql`, `,
      )})`
    : sql`and h.host !~* ${RESERVED_HOST_PATTERN}`;
  return db.transaction(async (tx) => {
    const hosts = await tx.execute<{ host: string }>(sql`
      select h.host from crawl_host h
      where not h.blocked
        and (h.next_allowed_at is null or h.next_allowed_at <= now())
        and exists (
          select 1 from crawl_frontier f
          where f.host = h.host and f.status = 'queued' and f.next_attempt_at <= now()
        )
        ${hostFilter}
      order by h.next_allowed_at asc nulls first
      limit 1
      for update of h skip locked`);
    const host = hosts.rows[0]?.host;
    if (!host) return null;
    const rows = await tx.execute<ClaimedRow>(sql`
      select id from crawl_frontier
      where host = ${host} and status = 'queued' and next_attempt_at <= now()
      order by priority desc, created_at asc
      limit 1
      for update skip locked`);
    const id = rows.rows[0]?.id;
    if (!id) return null;
    const lease = new Date(Date.now() + leaseMs);
    const [hostRow] = await tx
      .update(schema.crawlHost)
      .set({ nextAllowedAt: lease })
      .where(eq(schema.crawlHost.host, host))
      .returning();
    const [row] = await tx
      .update(schema.crawlFrontier)
      .set({ status: "fetching", attempts: sql`${schema.crawlFrontier.attempts} + 1`, nextAttemptAt: lease })
      .where(eq(schema.crawlFrontier.id, id))
      .returning();
    if (!row || !hostRow) return null;
    return { row, host: hostRow };
  });
}

/** When the next request to a host may start (null when nothing is waiting on these hosts). */
export async function nextDueAt(hosts?: string[]): Promise<Date | null> {
  const filter = hosts?.length
    ? sql`and f.host in (${sql.join(
        hosts.map((h) => sql`${h}`),
        sql`, `,
      )})`
    : sql``;
  const res = await db.execute<{ due: Date | string | null }>(sql`
    select min(greatest(f.next_attempt_at, coalesce(h.next_allowed_at, f.next_attempt_at))) as due
    from crawl_frontier f join crawl_host h on h.host = f.host
    where f.status = 'queued' and not h.blocked ${filter}`);
  const due = res.rows[0]?.due;
  return due ? new Date(due) : null;
}

export type Outcome =
  | { type: "done"; statusCode: number | null; requested: boolean }
  | { type: "skipped"; reason: string; statusCode?: number | null; requested: boolean }
  | { type: "retry"; reason: string; statusCode: number | null }
  | { type: "failed"; reason: string; statusCode: number | null; requested: boolean };

/**
 * Settle a claimed URL and release its host: success schedules the re-crawl for its kind; a
 * transient failure (429, 5xx, timeout, network) backs off exponentially and counts against the
 * host, which is blocked after too many consecutive errors; permanent failures and skips don't.
 */
export async function settle(
  claim: Claim,
  outcome: Outcome,
  recrawlDays: Partial<Record<FrontierKind, number>>,
): Promise<void> {
  const config = fleetConfig();
  const now = Date.now();
  const { row, host } = claim;
  const delay = Math.max(config.minDelayMs, host.crawlDelayMs);
  const release = (requested: boolean) => new Date(now + (requested ? delay : 0));

  if (outcome.type === "retry") {
    const errors = host.errorCount + 1;
    const blocked = errors >= config.hostErrorLimit;
    const finalAttempt = row.attempts >= config.maxAttempts;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.crawlFrontier)
        .set({
          status: finalAttempt ? "failed" : "queued",
          nextAttemptAt: new Date(now + backoffMs(row.attempts)),
          lastStatusCode: outcome.statusCode,
          skippedReason: outcome.reason,
          fetchedAt: new Date(now),
        })
        .where(eq(schema.crawlFrontier.id, row.id));
      await tx
        .update(schema.crawlHost)
        .set({
          errorCount: errors,
          nextAllowedAt: new Date(now + Math.max(delay, backoffMs(errors))),
          ...(blocked ? { blocked: true, blockedReason: `${errors} errors in a row (last: ${outcome.reason})` } : {}),
        })
        .where(eq(schema.crawlHost.host, host.host));
    });
    return;
  }

  const fields =
    outcome.type === "done"
      ? {
          status: "done" as const,
          skippedReason: null,
          nextAttemptAt: new Date(now + recrawlIntervalMs(row.kind, recrawlDays)),
        }
      : outcome.type === "skipped"
        ? {
            status: "skipped" as const,
            skippedReason: outcome.reason,
            nextAttemptAt: new Date(now + recrawlIntervalMs(row.kind, recrawlDays)),
          }
        : { status: "failed" as const, skippedReason: outcome.reason, nextAttemptAt: new Date(now) };
  await db.transaction(async (tx) => {
    await tx
      .update(schema.crawlFrontier)
      .set({
        ...fields,
        lastStatusCode: outcome.statusCode ?? null,
        fetchedAt: outcome.requested ? new Date(now) : row.fetchedAt,
      })
      .where(eq(schema.crawlFrontier.id, row.id));
    await tx
      .update(schema.crawlHost)
      .set({
        nextAllowedAt: release(outcome.requested),
        ...(outcome.type === "done" ? { errorCount: 0 } : {}),
      })
      .where(eq(schema.crawlHost.host, host.host));
  });
}

/** Put URLs whose re-crawl time has come back in the queue, and recover leases of crashed workers. */
export async function requeueDue(limit = 5_000): Promise<{ requeued: number; recovered: number }> {
  const requeued = await db.execute(sql`
    update crawl_frontier set status = 'queued', attempts = 0
    where id in (
      select id from crawl_frontier
      where status = 'done' and next_attempt_at <= now()
      order by next_attempt_at
      limit ${limit}
    )`);
  const recovered = await db.execute(sql`
    update crawl_frontier set status = 'queued'
    where status = 'fetching' and next_attempt_at <= now()`);
  return { requeued: requeued.rowCount ?? 0, recovered: recovered.rowCount ?? 0 };
}

/** Store the robots.txt we fetched (or "" when the site has none) and the delay it asks for. */
export async function saveRobots(host: string, robotsTxt: string, crawlDelayMs: number): Promise<HostRow | null> {
  const [row] = await db
    .update(schema.crawlHost)
    .set({ robotsTxt, robotsFetchedAt: new Date(), crawlDelayMs })
    .where(eq(schema.crawlHost.host, host))
    .returning();
  return row ?? null;
}
