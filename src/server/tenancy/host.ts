import "server-only";

import { and, eq, gt, or } from "drizzle-orm";

import { db, schema } from "@/server/db";
import { env, primaryHosts } from "@/server/env";
import { cacheGet, cacheSet } from "@/server/redis";

/** How long a failing hostname keeps serving after its DNS proof disappears. */
export const FAILING_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type Tenant =
  | { kind: "primary"; host: string }
  | { kind: "workspace"; host: string; organizationId: string; domainId: string };

/** The request's hostname (lowercase, with port), honouring X-Forwarded-Host only behind a trusted proxy. */
export function requestHost(headers: Headers): string {
  const forwarded = env().APP_TRUST_PROXY ? headers.get("x-forwarded-host") : null;
  return (forwarded ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
}

export function requestOrigin(headers: Headers): string {
  return `${env().APP_PROTOCOL}://${requestHost(headers)}`;
}

/** True for development names that can't be proven through public DNS (verified on add). */
export function isLocalHostname(hostname: string): boolean {
  const bare = hostname.replace(/:\d+$/, "");
  return bare === "localhost" || bare.endsWith(".localhost") || /:\d+$/.test(hostname);
}

const cacheKey = (host: string) => `anhour:tenant:${host}`;

/**
 * Resolve which tenant a hostname serves: the installation's own brand, a workspace's verified
 * (or failing, within grace) custom hostname, or nothing (unknown host → 404).
 */
export async function resolveTenant(host: string): Promise<Tenant | null> {
  if (!host) return null;
  if (primaryHosts().includes(host)) return { kind: "primary", host };

  const cached = await cacheGet<Tenant | { kind: "none" }>(cacheKey(host));
  if (cached) return cached.kind === "none" ? null : cached;

  const graceStart = new Date(Date.now() - FAILING_GRACE_MS);
  const [row] = await db
    .select({ id: schema.workspaceDomain.id, organizationId: schema.workspaceDomain.organizationId })
    .from(schema.workspaceDomain)
    .where(
      and(
        eq(schema.workspaceDomain.hostname, host),
        or(
          eq(schema.workspaceDomain.status, "verified"),
          and(eq(schema.workspaceDomain.status, "failing"), gt(schema.workspaceDomain.failingSince, graceStart)),
        ),
      ),
    )
    .limit(1);

  const tenant: Tenant | null = row
    ? { kind: "workspace", host, organizationId: row.organizationId, domainId: row.id }
    : null;
  await cacheSet(cacheKey(host), tenant ?? { kind: "none" }, 60);
  return tenant;
}

export async function invalidateTenant(host: string): Promise<void> {
  const { cacheDel } = await import("@/server/redis");
  await cacheDel(cacheKey(host));
}
