import "server-only";

import { env } from "@/server/env";

import { MIN_HOST_DELAY_MS } from "./classify";

/**
 * Crawler fleet settings from the environment (read directly so the app's env schema stays
 * unchanged). Every value has a safe default and a hard floor or ceiling.
 *
 *   CRAWLER_CONCURRENCY          pages fetched in parallel per worker process (default 4, max 32)
 *   CRAWLER_MAX_PAGES_PER_HOST   pages queued per host per re-crawl cycle (default 25, max 200)
 *   CRAWLER_MIN_DELAY_MS         pause between two requests to one host (default and floor 2000)
 *   CRAWLER_HOST_ERROR_LIMIT     consecutive errors before a host is blocked (default 8)
 *   CRAWLER_MAX_ATTEMPTS         attempts per URL before it is marked failed (default 5)
 *   CRAWLER_HEARTBEAT_FILE       touched by the worker for the container healthcheck
 *   CRAWLER_CONTACT_URL          where site owners learn about the crawler or ask for removal
 *   CRAWLER_USER_AGENT           product token + version; the contact URL is appended when missing
 */
export interface FleetConfig {
  concurrency: number;
  maxPagesPerHost: number;
  minDelayMs: number;
  hostErrorLimit: number;
  maxAttempts: number;
  /** How long a claimed URL (and its host) stays reserved before another worker may retry it. */
  leaseMs: number;
  fetchTimeoutMs: number;
  maxPageBytes: number;
  maxDepth: number;
  heartbeatFile: string;
  allowPrivate: boolean;
  userAgent: string;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

/** CRAWLER_USER_AGENT with a contact URL, e.g. "AnhourLeadsBot/0.1 (+https://leads.example.com/privacy/removal)". */
export function crawlerUserAgent(): string {
  const base = env().CRAWLER_USER_AGENT.trim();
  if (/\+?https?:\/\//i.test(base)) return base;
  const contact =
    process.env.CRAWLER_CONTACT_URL?.trim() || `${env().BETTER_AUTH_URL.replace(/\/+$/, "")}/privacy/removal`;
  return `${base} (+${contact})`;
}

export function fleetConfig(): FleetConfig {
  return {
    concurrency: int("CRAWLER_CONCURRENCY", 4, 1, 32),
    maxPagesPerHost: int("CRAWLER_MAX_PAGES_PER_HOST", 25, 1, 200),
    minDelayMs: int("CRAWLER_MIN_DELAY_MS", MIN_HOST_DELAY_MS, MIN_HOST_DELAY_MS, 60_000),
    hostErrorLimit: int("CRAWLER_HOST_ERROR_LIMIT", 8, 2, 100),
    maxAttempts: int("CRAWLER_MAX_ATTEMPTS", 5, 1, 20),
    leaseMs: 5 * 60_000,
    fetchTimeoutMs: 10_000,
    maxPageBytes: 2_000_000,
    maxDepth: 2,
    heartbeatFile: process.env.CRAWLER_HEARTBEAT_FILE ?? "/tmp/crawler-heartbeat",
    allowPrivate: env().CRAWLER_ALLOW_PRIVATE_HOSTS,
    userAgent: crawlerUserAgent(),
  };
}
