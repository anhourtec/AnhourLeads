import { NextResponse } from "next/server";

import { createSeedSource, listSeedSources, seedCreateInput } from "@/server/discovery/seeds";
import { readJson, route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";

/** Seed sources for the discovery index. Platform administrators only. */
export const GET = route(async ({ actor }) => {
  requirePlatformAdmin(actor);
  return { seed_sources: await listSeedSources() };
});

export const POST = route(async ({ req, actor }) => {
  requirePlatformAdmin(actor);
  const source = await createSeedSource(seedCreateInput.parse(await readJson(req)));
  await audit(actor, "discovery.seed_source.create", "seed_source", source.id, { kind: source.kind });
  return NextResponse.json({ seed_source: source }, { status: 201 });
});
