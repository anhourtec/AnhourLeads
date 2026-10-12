import "server-only";

import type { Actor } from "@/server/auth/actor";

import { audit } from "./audit";
import type { Lookup } from "./enrichment-common";

/**
 * Usage events for the usage & activity page. There is no dedicated usage table yet, so each
 * enrichment request writes one audit entry (`usage.lookup`, entity type `usage`) summarising its
 * lookups: how many by type and how many were served from cache (free, never paid twice).
 */
export const USAGE_ACTION = "usage.lookup";

export type UsageKind = Lookup["type"] | "csv_enrichment_row";

export async function recordLookups(
  actor: Pick<Actor, "organizationId" | "userId" | "apiKeyId">,
  lookups: Array<Pick<Lookup, "type" | "cached">>,
  extra: Partial<Record<UsageKind, number>> = {},
): Promise<void> {
  const counts: Partial<Record<UsageKind, number>> = { ...extra };
  let cached = 0;
  for (const l of lookups) {
    counts[l.type] = (counts[l.type] ?? 0) + 1;
    if (l.cached) cached += 1;
  }
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  if (!total) return;
  await audit(actor, USAGE_ACTION, "usage", null, { counts, cached, total });
}
