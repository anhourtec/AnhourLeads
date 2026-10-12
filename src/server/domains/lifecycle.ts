import "server-only";

import { and, eq, inArray, isNull, lt, notLike, or } from "drizzle-orm";

import type { Actor } from "@/server/auth/actor";
import { dropAuth } from "@/server/auth/auth";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { log } from "@/server/log";
import { redis } from "@/server/redis";
import { audit } from "@/server/services/audit";
import { invalidateTenant, isLocalHostname } from "@/server/tenancy/host";

import { type CertCheck, checkCertificate } from "./cert-check";
import { checkRouting, checkVerificationTxt } from "./dns";
import { domainTarget, PENDING_TTL_MS } from "./hostname";
import { isServing, PENDING_RECHECK_MS, RECHECK_MS, switchOffAt } from "./serving";

/**
 * The hostname lifecycle (docs/domains-and-ssl.md):
 *
 *   pending ──proof found──▶ verified ──proof gone──▶ failing ──7 days──▶ (stops serving)
 *                               ▲                        │
 *                               └──────proof back────────┘
 *
 * Inconclusive DNS never changes state. Every status change drops the host's tenant cache and auth
 * instance so it takes effect on the next request, and is audit-logged.
 */

export type DomainRow = typeof schema.workspaceDomain.$inferSelect;
type AuditActor = Pick<Actor, "organizationId" | "userId" | "apiKeyId">;

const logger = log.child({ component: "domains" });

/** Make a state change take effect on the next request. */
export async function invalidateHost(hostname: string): Promise<void> {
  await invalidateTenant(hostname);
  dropAuth(hostname);
}

function systemActor(organizationId: string): AuditActor {
  return { organizationId, userId: null, apiKeyId: null };
}

function certColumns(cert: CertCheck | null): Partial<DomainRow> {
  if (!cert) return { certStatus: "none", certExpiresAt: null };
  return { certStatus: cert.status, certExpiresAt: cert.expiresAt };
}

/** The certificate for a serving hostname, or null when this installation doesn't manage certificates. */
async function certificateFor(hostname: string): Promise<CertCheck | null> {
  const provider = env().APP_TLS_PROVIDER;
  if (provider === "none") return null;
  // NGINX + certbot: read what THIS installation serves for the name (connect to our own address).
  if (provider === "nginx") return checkCertificate(hostname, { via: domainTarget() });
  return checkCertificate(hostname);
}

export interface CheckOutcome {
  ok: boolean;
  error: string | null;
}

/**
 * Check a hostname now: proof of ownership, routing (informational) and, while it serves, its
 * certificate. `actor` is null for background re-checks.
 */
export async function checkDomain(
  id: string,
  opts: { actor: AuditActor | null; manual: boolean },
): Promise<CheckOutcome> {
  const [row] = await db.select().from(schema.workspaceDomain).where(eq(schema.workspaceDomain.id, id)).limit(1);
  if (!row) return { ok: false, error: "Hostname not found." };
  const now = new Date();
  const actor = opts.actor ?? systemActor(row.organizationId);

  // Local development names can't be proven through public DNS: verified on add, never re-checked.
  if (isLocalHostname(row.hostname)) {
    await db
      .update(schema.workspaceDomain)
      .set({ lastCheckedAt: now, lastError: null })
      .where(eq(schema.workspaceDomain.id, id));
    return { ok: true, error: null };
  }

  const [txt, routing] = await Promise.all([
    checkVerificationTxt(row.hostname, row.verificationToken),
    checkRouting(row.hostname),
  ]);

  let status = row.status;
  let failingSince = row.failingSince;
  let verifiedAt = row.verifiedAt;
  if (txt.found) {
    if (status !== "verified") verifiedAt = now;
    status = "verified";
    failingSince = null;
  } else if (!txt.inconclusive && status === "verified") {
    status = "failing";
    failingSince = now;
  }

  const serving = isServing({ status, failingSince }, now);
  const cert = serving ? await certificateFor(row.hostname) : null;

  await db
    .update(schema.workspaceDomain)
    .set({
      status,
      failingSince,
      verifiedAt,
      lastCheckedAt: now,
      lastError: txt.found ? null : txt.error,
      ...(routing.inconclusive ? {} : { routing: routing.pointed ? "pointed" : "not_pointed" }),
      ...certColumns(cert),
    })
    .where(eq(schema.workspaceDomain.id, id));

  const meta = { hostname: row.hostname };
  if (status !== row.status) await invalidateHost(row.hostname);
  if (status === "verified" && row.status !== "verified") {
    await audit(actor, "domain.verify", "workspace_domain", id, meta);
    logger.info("hostname verified", { domainId: id, hostname: row.hostname });
  } else if (status === "failing" && row.status === "verified") {
    await audit(actor, "domain.failing", "workspace_domain", id, {
      ...meta,
      switchOffAt: switchOffAt({ status, failingSince })?.toISOString(),
    });
    logger.warn("hostname failing verification", { domainId: id, hostname: row.hostname });
  } else if (opts.manual && !txt.found) {
    await audit(actor, "domain.verify_failed", "workspace_domain", id, { ...meta, error: txt.error });
  }

  // The grace period ran out since the last check: it stops serving now.
  const off = status === "failing" ? switchOffAt({ status, failingSince }) : null;
  if (off && off <= now && (!row.lastCheckedAt || row.lastCheckedAt < off)) {
    await invalidateHost(row.hostname);
    await audit(actor, "domain.switched_off", "workspace_domain", id, meta);
    logger.warn("hostname switched off after the grace period", { domainId: id, hostname: row.hostname });
  }
  return { ok: txt.found, error: txt.found ? null : txt.error };
}

const LOCK_SECONDS = 300;

/**
 * Run `fn` once at a time per hostname, across app and scheduler processes (Redis lock). Returns
 * false when another process holds the lock or Redis is unavailable.
 */
export async function withHostnameLock(hostname: string, fn: () => Promise<unknown>): Promise<boolean> {
  const client = redis();
  if (!client) {
    await fn();
    return true;
  }
  const key = `anhour:domain:lock:${hostname}`;
  let acquired = false;
  try {
    acquired = (await client.set(key, String(process.pid), "EX", LOCK_SECONDS, "NX")) === "OK";
  } catch {
    return false;
  }
  if (!acquired) return false;
  try {
    await fn();
  } finally {
    await client.del(key).catch(() => undefined);
  }
  return true;
}

export function pendingExpired(row: Pick<DomainRow, "status" | "createdAt">, now = Date.now()): boolean {
  return row.status === "pending" && now - row.createdAt.getTime() > PENDING_TTL_MS;
}

/** Delete one expired pending claim and audit it. */
export async function expirePendingClaim(row: DomainRow): Promise<void> {
  await db
    .delete(schema.workspaceDomain)
    .where(and(eq(schema.workspaceDomain.id, row.id), eq(schema.workspaceDomain.status, "pending")));
  await invalidateHost(row.hostname);
  await audit(systemActor(row.organizationId), "domain.expired", "workspace_domain", row.id, {
    hostname: row.hostname,
    reason: "not verified within 7 days",
  });
}

/** Remove every pending claim older than 7 days. */
export async function expirePendingClaims(): Promise<number> {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  const rows = await db
    .select()
    .from(schema.workspaceDomain)
    .where(and(eq(schema.workspaceDomain.status, "pending"), lt(schema.workspaceDomain.createdAt, cutoff)));
  for (const row of rows) await expirePendingClaim(row);
  return rows.length;
}

export interface RecheckSummary {
  checked: number;
  verified: number;
  notVerified: number;
  skipped: number;
  expired: number;
}

/**
 * Re-check every hostname that is due: pending ones every 5 minutes (until the claim expires),
 * verified / failing ones at most hourly. Local names are never re-checked. Safe to run
 * concurrently: each hostname is checked under its own lock.
 */
export async function recheckDue(): Promise<RecheckSummary> {
  const expired = await expirePendingClaims();
  const now = Date.now();
  const d = schema.workspaceDomain;
  const rows = await db
    .select({ id: d.id, hostname: d.hostname })
    .from(d)
    .where(
      and(
        notLike(d.hostname, "%:%"),
        notLike(d.hostname, "%.localhost"),
        or(
          and(
            inArray(d.status, ["verified", "failing"]),
            or(isNull(d.lastCheckedAt), lt(d.lastCheckedAt, new Date(now - RECHECK_MS))),
          ),
          and(
            eq(d.status, "pending"),
            or(isNull(d.lastCheckedAt), lt(d.lastCheckedAt, new Date(now - PENDING_RECHECK_MS))),
          ),
        ),
      ),
    );

  const summary: RecheckSummary = { checked: 0, verified: 0, notVerified: 0, skipped: 0, expired };
  for (const row of rows) {
    if (isLocalHostname(row.hostname)) continue;
    const ran = await withHostnameLock(row.hostname, async () => {
      try {
        const outcome = await checkDomain(row.id, { actor: null, manual: false });
        summary.checked++;
        if (outcome.ok) summary.verified++;
        else summary.notVerified++;
      } catch (error) {
        logger.error("hostname re-check failed", { domainId: row.id, hostname: row.hostname, error });
      }
    });
    if (!ran) summary.skipped++;
  }
  return summary;
}
