import "server-only";

import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { MAX_HOSTNAME_LIMIT } from "@/server/domains/hostname";
import { forbidden, notFound } from "@/server/http/errors";
import { isLocalHostname } from "@/server/tenancy/host";

import { audit } from "./audit";

/**
 * Installation administration. Only signed-in users with `user.role = "admin"` (platform
 * administrators) pass; workspace roles don't matter and API keys never count.
 */
export function requirePlatformAdmin(actor: Actor): void {
  if (actor.kind !== "user" || !actor.isPlatformAdmin) throw forbidden();
}

export interface PlatformWorkspace {
  id: string;
  name: string;
  slug: string;
  brandName: string | null;
  memberCount: number;
  hostnameLimit: number;
  /** Custom (non-local) hostnames counted against the limit. */
  hostnamesUsed: number;
  hostnames: { id: string; hostname: string; status: "pending" | "verified" | "failing"; local: boolean }[];
  createdAt: string;
}

export async function listWorkspaces(): Promise<PlatformWorkspace[]> {
  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      brandName: schema.organization.brandName,
      hostnameLimit: schema.organization.hostnameLimit,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .orderBy(asc(schema.organization.name));
  const members = await db
    .select({ organizationId: schema.member.organizationId, n: count() })
    .from(schema.member)
    .groupBy(schema.member.organizationId);
  const domains = await db
    .select({
      id: schema.workspaceDomain.id,
      organizationId: schema.workspaceDomain.organizationId,
      hostname: schema.workspaceDomain.hostname,
      status: schema.workspaceDomain.status,
    })
    .from(schema.workspaceDomain)
    .orderBy(asc(schema.workspaceDomain.hostname));

  const memberCount = new Map(members.map((m) => [m.organizationId, Number(m.n)]));
  return orgs.map((o) => {
    const hostnames = domains
      .filter((d) => d.organizationId === o.id)
      .map((d) => ({ id: d.id, hostname: d.hostname, status: d.status, local: isLocalHostname(d.hostname) }));
    return {
      ...o,
      memberCount: memberCount.get(o.id) ?? 0,
      hostnamesUsed: hostnames.filter((h) => !h.local).length,
      hostnames,
      createdAt: o.createdAt.toISOString(),
    };
  });
}

export const workspaceLimitInput = z.strictObject({
  hostnameLimit: z
    .number({ error: `Enter a whole number from 0 to ${MAX_HOSTNAME_LIMIT}.` })
    .int(`Enter a whole number from 0 to ${MAX_HOSTNAME_LIMIT}.`)
    .min(0, `Enter a whole number from 0 to ${MAX_HOSTNAME_LIMIT}.`)
    .max(MAX_HOSTNAME_LIMIT, `Enter a whole number from 0 to ${MAX_HOSTNAME_LIMIT}.`),
});

/**
 * Set how many custom hostnames a workspace may have. Lowering it removes nothing; the workspace
 * just can't add more. Audited in the target workspace.
 */
export async function setHostnameLimit(
  actor: Actor,
  organizationId: string,
  limit: number,
): Promise<PlatformWorkspace> {
  requirePlatformAdmin(actor);
  const [org] = await db
    .select({ hostnameLimit: schema.organization.hostnameLimit })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw notFound();
  if (org.hostnameLimit !== limit) {
    await db
      .update(schema.organization)
      .set({ hostnameLimit: limit, updatedAt: new Date() })
      .where(eq(schema.organization.id, organizationId));
    await audit({ ...actor, organizationId }, "domain.limit_update", "workspace", organizationId, {
      from: org.hostnameLimit,
      to: limit,
    });
  }
  const workspace = (await listWorkspaces()).find((w) => w.id === organizationId);
  if (!workspace) throw notFound();
  return workspace;
}
