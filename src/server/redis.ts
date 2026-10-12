import "server-only";

import Redis from "ioredis";

import { env } from "@/server/env";
import { log } from "@/server/log";

const globalForRedis = globalThis as unknown as { anhourRedis?: Redis | null };

/** Shared Redis client, or null when REDIS_URL is unset. Redis is an optimisation: callers must tolerate failures. */
export function redis(): Redis | null {
  if (globalForRedis.anhourRedis !== undefined) return globalForRedis.anhourRedis;
  const url = env().REDIS_URL;
  if (!url) {
    globalForRedis.anhourRedis = null;
    return null;
  }
  const client = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  client.on("error", (error) => log.warn("redis error", { component: "redis", error }));
  globalForRedis.anhourRedis = client;
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis()?.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis()?.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache failures are never fatal.
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    if (keys.length) await redis()?.del(...keys);
  } catch {
    // Cache failures are never fatal.
  }
}
