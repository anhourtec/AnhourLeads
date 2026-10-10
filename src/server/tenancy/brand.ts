import "server-only";

import { eq } from "drizzle-orm";

import { type Brand, DEFAULT_BRAND, isBrandColor } from "@/config/brand";
import { db, schema } from "@/server/db";
import { cacheDel, cacheGet, cacheSet } from "@/server/redis";

const key = (organizationId: string) => `anhour:brand:${organizationId}`;

/** A workspace's brand, falling back field by field to the installation defaults. */
export async function workspaceBrand(organizationId: string): Promise<Brand> {
  const cached = await cacheGet<Brand>(key(organizationId));
  if (cached) return cached;
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
  if (!org) return DEFAULT_BRAND;
  const brand: Brand = {
    name: org.brandName || org.name,
    color: isBrandColor(org.brandColor) ? org.brandColor : DEFAULT_BRAND.color,
    supportEmail: org.supportEmail,
    isWorkspaceBrand: true,
  };
  await cacheSet(key(organizationId), brand, 300);
  return brand;
}

export async function invalidateBrand(organizationId: string): Promise<void> {
  await cacheDel(key(organizationId));
}
