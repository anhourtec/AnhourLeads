import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { verificationRecordName, verificationRecordValue } from "@/server/domains/dns";
import { bareHost, domainTarget, MAX_LOCAL_HOSTNAMES, PENDING_TTL_MS, parseHostname } from "@/server/domains/hostname";
import {
  checkDomain,
  type DomainRow,
  expirePendingClaim,
  invalidateHost,
  pendingExpired,
} from "@/server/domains/lifecycle";
import { isServing, switchOffAt } from "@/server/domains/serving";
import { env } from "@/server/env";
import { conflict, HttpError, notFound } from "@/server/http/errors";
import { redis } from "@/server/redis";
import { isLocalHostname } from "@/server/tenancy/host";

import { audit } from "./audit";
import { randomBytes } from "node:crypto";

export type TlsProvider = "nginx" | "cloudflare" | "none";

export interface DnsRecord {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
  purpose: "routing" | "ownership";
}

/** One hostname as Settings → Domains shows it. Only returned to people with `domain:read`. */
export interface DomainView {
  id: string;
  hostname: string;
  status: "pending" | "verified" | "failing";
  /** Local development hostname (`*.localhost` or with a port): verified on add, no DNS, no certificate. */
  local: boolean;
  /** Serves the workspace right now (verified, or failing within the grace period). */
  serving: boolean;
  switchOffAt: string | null;
  /** When an unverified claim is removed. */
  claimExpiresAt: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  routing: "unknown" | "pointed" | "not_pointed";
  cert: { status: "none" | "waiting" | "active" | "problem"; expiresAt: string | null };
  createdAt: string;
  records: DnsRecord[];
}

export interface DomainsView {
  provider: TlsProvider;
  /** Where hostnames point their CNAME. */
  target: string;
  limit: number;
  used: number;
  localUsed: number;
  localLimit: number;
  domains: DomainView[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toView(d: DomainRow, now = new Date()): DomainView {
  const local = isLocalHostname(d.hostname);
  return {
    id: d.id,
    hostname: d.hostname,
    status: d.status,
    local,
    serving: isServing(d, now),
    switchOffAt: iso(switchOffAt(d)),
    claimExpiresAt: d.status === "pending" ? new Date(d.createdAt.getTime() + PENDING_TTL_MS).toISOString() : null,
    verifiedAt: iso(d.verifiedAt),
    lastCheckedAt: iso(d.lastCheckedAt),
    lastError: d.lastError,
    routing: d.routing,
    cert: { status: d.certStatus, expiresAt: iso(d.certExpiresAt) },
    createdAt: d.createdAt.toISOString(),
    records: local
      ? []
      : [
          { type: "CNAME", name: bareHost(d.hostname), value: domainTarget(), purpose: "routing" },
          {
            type: "TXT",
            name: verificationRecordName(d.hostname),
            value: verificationRecordValue(d.verificationToken),
            purpose: "ownership",
          },
        ],
  };
}

async function hostnameLimit(organizationId: string): Promise<number> {
  const [org] = await db
    .select({ limit: schema.organization.hostnameLimit })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return org?.limit ?? 0;
}

/** Hostnames of one workspace, with usage. Callers check `domain:read` first. */
export async function listDomains(organizationId: string): Promise<DomainsView> {
  const rows = await db
    .select()
    .from(schema.workspaceDomain)
    .where(eq(schema.workspaceDomain.organizationId, organizationId))
    .orderBy(asc(schema.workspaceDomain.createdAt));
  const now = new Date();
  const domains = rows.map((r) => toView(r, now));
  return {
    provider: env().APP_TLS_PROVIDER,
    target: domainTarget(),
    limit: await hostnameLimit(organizationId),
    used: domains.filter((d) => !d.local).length,
    localUsed: domains.filter((d) => d.local).length,
    localLimit: MAX_LOCAL_HOSTNAMES,
    domains,
  };
}

/** A hostname of the actor's workspace. Other workspaces' ids are 404, never 403. */
async function ownDomain(actor: Actor, id: string): Promise<DomainRow> {
  const [row] = await db
    .select()
    .from(schema.workspaceDomain)
    .where(and(eq(schema.workspaceDomain.id, id), eq(schema.workspaceDomain.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

const unprocessable = (message: string) => new HttpError(422, message, [{ path: "hostname", message }]);

/**
 * Add a hostname to the actor's workspace. A new public hostname is pending until DNS proves the
 * workspace controls it; local development names are verified straight away.
 */
export async function addDomain(
  actor: Actor,
  rawHostname: unknown,
): Promise<{ domain: DomainView; warning: string | null }> {
  const { hostname, local, apex } = parseHostname(rawHostname);

  const [existing] = await db
    .select()
    .from(schema.workspaceDomain)
    .where(eq(schema.workspaceDomain.hostname, hostname))
    .limit(1);
  if (existing) {
    // An unverified claim older than 7 days no longer blocks the name.
    if (pendingExpired(existing)) await expirePendingClaim(existing);
    else throw conflict("That hostname is already in use.");
  }

  const now = new Date();
  // The limit check and the insert share a transaction holding the workspace row, so two adds at
  // once can't both pass.
  const row = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({ limit: schema.organization.hostnameLimit })
      .from(schema.organization)
      .where(eq(schema.organization.id, actor.organizationId))
      .for("update");
    const rows = await tx
      .select({ hostname: schema.workspaceDomain.hostname })
      .from(schema.workspaceDomain)
      .where(eq(schema.workspaceDomain.organizationId, actor.organizationId));
    const used = rows.filter((r) => !isLocalHostname(r.hostname)).length;
    const limit = org?.limit ?? 0;
    if (local && rows.length - used >= MAX_LOCAL_HOSTNAMES) {
      throw unprocessable(`You can have up to ${MAX_LOCAL_HOSTNAMES} local development hostnames. Remove one first.`);
    }
    if (!local && used >= limit) {
      throw unprocessable(
        limit === 0
          ? "Custom hostnames aren't included for this workspace. Ask your platform administrator to add one."
          : `You've used all ${limit} of your custom hostname${limit === 1 ? "" : "s"}. Remove one, or ask your platform administrator to add more.`,
      );
    }
    const [inserted] = await tx
      .insert(schema.workspaceDomain)
      .values({
        organizationId: actor.organizationId,
        hostname,
        verificationToken: randomBytes(24).toString("base64url"),
        status: local ? "verified" : "pending",
        verifiedAt: local ? now : null,
        lastCheckedAt: local ? now : null,
        createdById: actor.userId,
      })
      .onConflictDoNothing({ target: schema.workspaceDomain.hostname })
      .returning();
    return inserted;
  });
  if (!row) throw conflict("That hostname is already in use.");

  // A lookup before the add may have cached "unknown host".
  await invalidateHost(hostname);
  await audit(actor, "domain.add", "workspace_domain", row.id, { hostname, status: row.status });
  return {
    domain: toView(row),
    warning: apex
      ? "Most DNS providers don't allow a CNAME on a root domain. A subdomain such as portal.example.com is recommended."
      : null,
  };
}

/** At most one manual check per hostname every 10 seconds (protects DNS and the certificate check). */
async function verifyRateLimit(hostname: string): Promise<void> {
  let ok = true;
  try {
    const client = redis();
    if (client) ok = (await client.set(`anhour:domain:verify:${hostname}`, "1", "EX", 10, "NX")) === "OK";
  } catch {
    ok = true;
  }
  if (!ok) throw new HttpError(429, "Checked a moment ago. Wait a few seconds and try again.");
}

/** "Verify now": look for the proof of ownership; a hit switches the hostname on. */
export async function verifyDomain(
  actor: Actor,
  id: string,
): Promise<{ ok: boolean; error: string | null; domain: DomainView }> {
  const row = await ownDomain(actor, id);
  await verifyRateLimit(row.hostname);
  const outcome = await checkDomain(row.id, { actor, manual: true });
  const updated = await ownDomain(actor, id);
  return { ...outcome, domain: toView(updated) };
}

/** Remove a hostname. Every session on it stops working on the next request. */
export async function removeDomain(actor: Actor, id: string): Promise<{ deleted: true }> {
  const row = await ownDomain(actor, id);
  await db.delete(schema.workspaceDomain).where(eq(schema.workspaceDomain.id, row.id));
  await invalidateHost(row.hostname);
  await audit(actor, "domain.remove", "workspace_domain", row.id, { hostname: row.hostname, status: row.status });
  return { deleted: true };
}
