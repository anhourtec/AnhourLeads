import "server-only";

import { and, eq, gt, or, type SQL } from "drizzle-orm";

import { schema } from "@/server/db";
import { FAILING_GRACE_MS } from "@/server/tenancy/host";

/** Live (verified / failing) hostnames are re-checked at most this often: a deleted record is noticed within an hour. */
export const RECHECK_MS = 60 * 60 * 1000;
/** Pending hostnames are re-checked this often until their TXT record is found or the claim expires. */
export const PENDING_RECHECK_MS = 5 * 60 * 1000;

type ServingFields = { status: "pending" | "verified" | "failing"; failingSince: Date | null };

/** When a failing hostname stops serving (null unless failing). */
export function switchOffAt(d: ServingFields): Date | null {
  return d.status === "failing" && d.failingSince ? new Date(d.failingSince.getTime() + FAILING_GRACE_MS) : null;
}

/** Does this hostname serve its workspace right now? Verified, or failing within the grace period. */
export function isServing(d: ServingFields, now = new Date()): boolean {
  if (d.status === "verified") return true;
  const off = switchOffAt(d);
  return off !== null && off.getTime() > now.getTime();
}

/** SQL twin of isServing() (the same rule as resolveTenant, tls-ask and the certbot sync). */
export function servingSql(now = new Date()): SQL {
  const graceStart = new Date(now.getTime() - FAILING_GRACE_MS);
  return or(
    eq(schema.workspaceDomain.status, "verified"),
    and(eq(schema.workspaceDomain.status, "failing"), gt(schema.workspaceDomain.failingSince, graceStart)),
  ) as SQL;
}
