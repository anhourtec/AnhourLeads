import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/server/db";

import { DEFAULT_RECRAWL_DAYS, FRONTIER_KINDS, type FrontierKind } from "./classify";

/**
 * Installation-wide discovery settings (platform administrators). There is no settings table yet,
 * so they are kept as one row of the generic `verification` table under a reserved identifier with
 * a far-future expiry. See docs/data-pipeline.md ("Gaps").
 */
const IDENTIFIER = "discovery:settings";
const FAR_FUTURE = new Date("9999-12-31T00:00:00Z");

export interface DiscoverySettings {
  /** People not seen on their source page for this many days are deleted. */
  retentionDays: number;
  /** Re-crawl interval per page kind, in days. */
  recrawlDays: Record<FrontierKind, number>;
}

export const DEFAULT_SETTINGS: DiscoverySettings = {
  retentionDays: 180,
  recrawlDays: { ...DEFAULT_RECRAWL_DAYS },
};

const recrawlShape = Object.fromEntries(
  FRONTIER_KINDS.map((k) => [k, z.number().int().min(1, "At least 1 day.").max(365, "At most 365 days.").optional()]),
) as Record<FrontierKind, z.ZodOptional<z.ZodNumber>>;

export const settingsInput = z.strictObject({
  retentionDays: z
    .number({ error: "Enter a number of days." })
    .int("Enter a whole number of days.")
    .min(7, "Keep people for at least 7 days.")
    .max(3650, "At most 3650 days.")
    .optional(),
  recrawlDays: z.strictObject(recrawlShape).optional(),
});

function merge(stored: unknown): DiscoverySettings {
  const parsed = settingsInput.safeParse(stored);
  const value = parsed.success ? parsed.data : {};
  const recrawl = { ...DEFAULT_SETTINGS.recrawlDays };
  for (const kind of FRONTIER_KINDS) {
    const days = value.recrawlDays?.[kind];
    if (days !== undefined) recrawl[kind] = days;
  }
  return { retentionDays: value.retentionDays ?? DEFAULT_SETTINGS.retentionDays, recrawlDays: recrawl };
}

export async function getDiscoverySettings(): Promise<DiscoverySettings> {
  const [row] = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, IDENTIFIER))
    .limit(1);
  if (!row) return merge({});
  try {
    return merge(JSON.parse(row.value));
  } catch {
    return merge({});
  }
}

export async function updateDiscoverySettings(input: z.infer<typeof settingsInput>): Promise<DiscoverySettings> {
  const current = await getDiscoverySettings();
  const next: DiscoverySettings = {
    retentionDays: input.retentionDays ?? current.retentionDays,
    recrawlDays: { ...current.recrawlDays, ...input.recrawlDays },
  };
  const value = JSON.stringify(next);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.verification)
      .set({ value, expiresAt: FAR_FUTURE })
      .where(eq(schema.verification.identifier, IDENTIFIER))
      .returning({ id: schema.verification.id });
    if (!updated.length) {
      await tx
        .insert(schema.verification)
        .values({ id: crypto.randomUUID(), identifier: IDENTIFIER, value, expiresAt: FAR_FUTURE });
    }
  });
  return next;
}
