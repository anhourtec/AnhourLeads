import "server-only";

import { redis } from "@/server/redis";

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  window: number;
}

export const LIMITS = {
  read: { max: 600, window: 60 },
  write: { max: 120, window: 60 },
  /** Expensive or abusable: enrichment, crawling, exports, key creation. */
  sensitive: { max: 30, window: 60 },
} satisfies Record<string, Limit>;

/** Fixed-window counter in Redis. Fails open: when Redis is unavailable the request is allowed. */
export async function hitLimit(key: string, limit: Limit): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const client = redis();
    if (!client) return { allowed: true, remaining: limit.max };
    const bucket = `anhour:rl:${key}:${Math.floor(Date.now() / 1000 / limit.window)}`;
    const count = await client.incr(bucket);
    if (count === 1) await client.expire(bucket, limit.window + 1);
    return { allowed: count <= limit.max, remaining: Math.max(0, limit.max - count) };
  } catch {
    return { allowed: true, remaining: limit.max };
  }
}
