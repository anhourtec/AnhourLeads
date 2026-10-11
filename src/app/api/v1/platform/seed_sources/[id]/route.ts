import { getSeedSource, seedUpdateInput, updateSeedSource } from "@/server/discovery/seeds";
import { readJson, route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";

/** One seed source: read, rename, enable or disable, change its configuration. Platform administrators only. */
export const GET = route<{ id: string }>(async ({ actor, params }) => {
  requirePlatformAdmin(actor);
  return { seed_source: await getSeedSource(params.id) };
});

export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => {
  requirePlatformAdmin(actor);
  const input = seedUpdateInput.parse(await readJson(req));
  const source = await updateSeedSource(params.id, input);
  await audit(actor, "discovery.seed_source.update", "seed_source", source.id, {
    fields: Object.keys(input).filter((k) => k !== "text"),
  });
  return { seed_source: source };
});
