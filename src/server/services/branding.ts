import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { BRAND_COLORS, type Brand, type BrandColor, DEFAULT_BRAND, isBrandColor } from "@/config/brand";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { invalidateBrand } from "@/server/tenancy/brand";

import { audit } from "./audit";

/** Plain text: no markup, no control characters. */
const PLAIN_TEXT = /^[^<>\p{Cc}]*$/u;

/** undefined stays undefined (field not sent); an empty string or null becomes null (reset). */
function emptyToNull<T extends string>(v: T | null | undefined): T | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v.length === 0) return null;
  return v;
}

/** PATCH body. Every field is optional; null (or an empty string) resets it to the default. */
export const brandingInput = z.strictObject({
  brandName: z
    .string()
    .trim()
    .max(60, "Use 60 characters or fewer.")
    .regex(PLAIN_TEXT, "Use plain text only, without < or > or control characters.")
    .nullable()
    .optional()
    .transform(emptyToNull),
  brandColor: z.enum(BRAND_COLORS, { error: "Choose one of the listed colours." }).nullable().optional(),
  supportEmail: z
    .union([z.literal(""), z.email("Enter a valid email address.").max(254)])
    .nullable()
    .optional()
    .transform((v) => {
      const value = emptyToNull(v);
      return typeof value === "string" ? value.toLowerCase() : value;
    }),
});

export type BrandingInput = z.infer<typeof brandingInput>;

export interface BrandingView {
  /** Saved values; null means "use the default". */
  brandName: string | null;
  brandColor: BrandColor | null;
  supportEmail: string | null;
  /** What people see: the saved values with defaults filled in. */
  effective: Brand;
  defaults: { name: string; color: BrandColor };
  colors: readonly BrandColor[];
}

export async function getBranding(organizationId: string): Promise<BrandingView> {
  const [org] = await db
    .select({
      name: schema.organization.name,
      brandName: schema.organization.brandName,
      brandColor: schema.organization.brandColor,
      supportEmail: schema.organization.supportEmail,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw notFound();
  const color = isBrandColor(org.brandColor) ? org.brandColor : null;
  return {
    brandName: org.brandName,
    brandColor: color,
    supportEmail: org.supportEmail,
    effective: {
      name: org.brandName || org.name,
      color: color ?? DEFAULT_BRAND.color,
      supportEmail: org.supportEmail,
      isWorkspaceBrand: true,
    },
    defaults: { name: org.name, color: DEFAULT_BRAND.color },
    colors: BRAND_COLORS,
  };
}

/** Change the workspace brand. Callers check `branding:update`. */
export async function updateBranding(actor: Actor, input: BrandingInput): Promise<BrandingView> {
  const before = await getBranding(actor.organizationId);
  const patch: Partial<typeof schema.organization.$inferInsert> = {};
  const changed: Record<string, { from: string | null; to: string | null }> = {};
  for (const key of ["brandName", "brandColor", "supportEmail"] as const) {
    const next = input[key];
    if (next === undefined || next === before[key]) continue;
    patch[key] = next;
    changed[key] = { from: before[key], to: next };
  }
  if (Object.keys(patch).length === 0) return before;

  await db
    .update(schema.organization)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.organization.id, actor.organizationId));
  await invalidateBrand(actor.organizationId);
  await audit(actor, "branding.update", "workspace", actor.organizationId, { changed });
  return getBranding(actor.organizationId);
}
