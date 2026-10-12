import { z } from "zod";

import { runOnce } from "@/server/crawler/fleet/worker";
import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { requirePlatformAdmin } from "@/server/services/platform";

const input = z.strictObject({
  max: z.number().int().min(1).max(50).default(10),
  /** Only claim URLs on these hosts ("acme.com", "127.0.0.1:48091"). */
  hosts: z.array(z.string().trim().toLowerCase().min(1).max(300)).max(20).optional(),
  /** Give up waiting for politeness windows after this long. */
  budgetMs: z.number().int().min(1_000).max(240_000).optional(),
});

/**
 * Process up to `max` frontier URLs synchronously, exactly as a worker would (same claiming,
 * robots, politeness and extraction), and return what happened to each. For tests and debugging;
 * production crawling runs in the crawler containers. Platform administrators only.
 */
export const POST = route(
  async ({ req, actor }) => {
    requirePlatformAdmin(actor);
    const { max, hosts, budgetMs } = input.parse(await readJson(req));
    const processed = await runOnce({ max, hosts, budgetMs });
    return { processed };
  },
  { limit: LIMITS.sensitive },
);
