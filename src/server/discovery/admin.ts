import "server-only";

import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { WORKER_KEY_PREFIX } from "@/server/crawler/fleet/worker";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { redis } from "@/server/redis";

import { FRONTIER_KINDS, FRONTIER_STATUSES } from "./classify";

/** Crawler fleet monitoring and controls for platform administrators. */

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);

export interface WorkerInfo {
  id: string;
  startedAt: string | null;
  lastBeatAt: string | null;
  processed: number;
  concurrency: number | null;
}

async function workers(): Promise<WorkerInfo[]> {
  try {
    const client = redis();
    if (!client) return [];
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await client.scan(cursor, "MATCH", `${WORKER_KEY_PREFIX}*`, "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < 500);
    if (!keys.length) return [];
    const values = await client.mget(...keys);
    return values
      .flatMap((raw) => {
        if (!raw) return [];
        try {
          const v = JSON.parse(raw) as Partial<WorkerInfo>;
          return [
            {
              id: String(v.id ?? "unknown"),
              startedAt: v.startedAt ?? null,
              lastBeatAt: v.lastBeatAt ?? null,
              processed: Number(v.processed ?? 0),
              concurrency: v.concurrency ?? null,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export async function crawlerStats() {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [byStatus, byKind, hosts, minutes, companies, people, gone, jobs, news, optouts, w] = await Promise.all([
    db
      .select({ status: schema.crawlFrontier.status, n: count() })
      .from(schema.crawlFrontier)
      .groupBy(schema.crawlFrontier.status),
    db
      .select({ kind: schema.crawlFrontier.kind, n: count() })
      .from(schema.crawlFrontier)
      .where(eq(schema.crawlFrontier.status, "queued"))
      .groupBy(schema.crawlFrontier.kind),
    db
      .select({
        total: count(),
        blocked: sql<number>`count(*) filter (where ${schema.crawlHost.blocked})`,
        backingOff: sql<number>`count(*) filter (where not ${schema.crawlHost.blocked} and ${schema.crawlHost.errorCount} > 0)`,
      })
      .from(schema.crawlHost),
    db
      .select({
        minute: sql<string>`to_char(date_trunc('minute', ${schema.crawlFrontier.fetchedAt}), 'YYYY-MM-DD"T"HH24:MI:00"Z"')`,
        n: count(),
      })
      .from(schema.crawlFrontier)
      .where(gt(schema.crawlFrontier.fetchedAt, since))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db.select({ n: count() }).from(schema.indexCompany),
    db.select({ n: count() }).from(schema.indexPerson).where(isNull(schema.indexPerson.goneAt)),
    db.select({ n: count() }).from(schema.indexPerson).where(isNotNull(schema.indexPerson.goneAt)),
    db.select({ n: count() }).from(schema.indexJobPosting),
    db.select({ n: count() }).from(schema.indexNews),
    db.select({ n: count() }).from(schema.indexOptout),
    workers(),
  ]);

  const frontier = Object.fromEntries(FRONTIER_STATUSES.map((s) => [s, 0])) as Record<
    (typeof FRONTIER_STATUSES)[number],
    number
  >;
  for (const r of byStatus) frontier[r.status] = Number(r.n);
  const queuedByKind = Object.fromEntries(FRONTIER_KINDS.map((k) => [k, 0])) as Record<
    (typeof FRONTIER_KINDS)[number],
    number
  >;
  for (const r of byKind) queuedByKind[r.kind] = Number(r.n);

  // One bucket per minute for the last hour, zeros included, oldest first.
  const counts = new Map(minutes.map((m) => [m.minute, Number(m.n)]));
  const start = Math.floor(Date.now() / 60_000) * 60_000 - 59 * 60_000;
  const throughput = Array.from({ length: 60 }, (_, i) => {
    const minute = new Date(start + i * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    return { minute, pages: counts.get(minute) ?? 0 };
  });
  const pagesLastHour = throughput.reduce((n, b) => n + b.pages, 0);

  return {
    frontier,
    queuedByKind,
    hosts: {
      total: Number(hosts[0]?.total ?? 0),
      blocked: Number(hosts[0]?.blocked ?? 0),
      backingOff: Number(hosts[0]?.backingOff ?? 0),
    },
    throughput,
    pagesLastHour,
    pagesPerMinute: Math.round((pagesLastHour / 60) * 10) / 10,
    index: {
      companies: Number(companies[0]?.n ?? 0),
      people: Number(people[0]?.n ?? 0),
      peopleGone: Number(gone[0]?.n ?? 0),
      jobPostings: Number(jobs[0]?.n ?? 0),
      news: Number(news[0]?.n ?? 0),
      optouts: Number(optouts[0]?.n ?? 0),
    },
    workers: w,
  };
}

export type CrawlerStats = Awaited<ReturnType<typeof crawlerStats>>;

export const frontierQuery = z.object({
  status: z.enum(FRONTIER_STATUSES).optional(),
  kind: z.enum(FRONTIER_KINDS).optional(),
  host: z.string().trim().max(300).optional(),
  q: z.string().trim().max(300).optional(),
});

export async function listFrontier(filters: z.infer<typeof frontierQuery>, page: { perPage: number; offset: number }) {
  const where = and(
    filters.status ? eq(schema.crawlFrontier.status, filters.status) : undefined,
    filters.kind ? eq(schema.crawlFrontier.kind, filters.kind) : undefined,
    filters.host ? eq(schema.crawlFrontier.host, filters.host.toLowerCase()) : undefined,
    filters.q ? ilike(schema.crawlFrontier.url, `%${escapeLike(filters.q)}%`) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(schema.crawlFrontier)
      .where(where)
      .orderBy(
        desc(schema.crawlFrontier.fetchedAt),
        desc(schema.crawlFrontier.priority),
        asc(schema.crawlFrontier.createdAt),
      )
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: count() }).from(schema.crawlFrontier).where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      url: r.url,
      host: r.host,
      kind: r.kind,
      priority: r.priority,
      depth: r.depth,
      status: r.status,
      attempts: r.attempts,
      nextAttemptAt: r.nextAttemptAt.toISOString(),
      lastStatusCode: r.lastStatusCode,
      skippedReason: r.skippedReason,
      discoveredFrom: r.discoveredFrom,
      fetchedAt: r.fetchedAt?.toISOString() ?? null,
    })),
    total: Number(total?.n ?? 0),
  };
}

export const hostsQuery = z.object({
  state: z.enum(["all", "blocked", "backoff"]).optional(),
  q: z.string().trim().max(300).optional(),
});

type HostRow = typeof schema.crawlHost.$inferSelect;

function hostView(h: HostRow) {
  return {
    host: h.host,
    blocked: h.blocked,
    blockedReason: h.blockedReason,
    errorCount: h.errorCount,
    crawlDelayMs: h.crawlDelayMs,
    nextAllowedAt: h.nextAllowedAt?.toISOString() ?? null,
    robotsFetchedAt: h.robotsFetchedAt?.toISOString() ?? null,
    hasRobots: Boolean(h.robotsTxt),
  };
}

export async function listHosts(filters: z.infer<typeof hostsQuery>, page: { perPage: number; offset: number }) {
  const conditions: Array<SQL | undefined> = [
    filters.state === "blocked" ? eq(schema.crawlHost.blocked, true) : undefined,
    filters.state === "backoff"
      ? and(eq(schema.crawlHost.blocked, false), gt(schema.crawlHost.errorCount, 0))
      : undefined,
    filters.q ? ilike(schema.crawlHost.host, `%${escapeLike(filters.q)}%`) : undefined,
  ];
  const where = and(...conditions);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(schema.crawlHost)
      .where(where)
      .orderBy(desc(schema.crawlHost.blocked), desc(schema.crawlHost.errorCount), asc(schema.crawlHost.host))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: count() }).from(schema.crawlHost).where(where),
  ]);
  return { hosts: rows.map(hostView), total: Number(total?.n ?? 0) };
}

export async function getHost(host: string) {
  const [row] = await db.select().from(schema.crawlHost).where(eq(schema.crawlHost.host, host.toLowerCase())).limit(1);
  return row ? hostView(row) : null;
}

/** Block or unblock a host by hand. Blocking a host nobody queued yet creates its row, so it stays blocked. */
export async function setHostBlocked(host: string, blocked: boolean, reason?: string | null) {
  const key = host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(key)) throw notFound("Host not found.");
  if (blocked) {
    await db
      .insert(schema.crawlHost)
      .values({ host: key, blocked: true, blockedReason: reason ?? "Blocked by a platform administrator" })
      .onConflictDoUpdate({
        target: schema.crawlHost.host,
        set: { blocked: true, blockedReason: reason ?? "Blocked by a platform administrator" },
      });
  } else {
    const updated = await db
      .update(schema.crawlHost)
      .set({ blocked: false, blockedReason: null, errorCount: 0, nextAllowedAt: null })
      .where(eq(schema.crawlHost.host, key))
      .returning({ host: schema.crawlHost.host });
    if (!updated.length) throw notFound("Host not found.");
  }
  const view = await getHost(key);
  if (!view) throw notFound("Host not found.");
  return view;
}
