import { runSeedSource } from "@/server/discovery/seeds";
import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";
import { asObject } from "@/server/services/records";

/**
 * Run a seed source now (synchronously) and return its stats. `refresh: true` makes list domains
 * that were already crawled due again. Platform administrators only.
 */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => {
    requirePlatformAdmin(actor);
    const body = asObject(await readJson(req));
    const source = await runSeedSource(params.id, { refresh: body.refresh === true });
    await audit(actor, "discovery.seed_source.run", "seed_source", source.id, { kind: source.kind });
    return { seed_source: source };
  },
  { limit: LIMITS.sensitive },
);
