import "server-only";

import { POLICY_BLOCK_REASONS, type SendingPolicyView } from "@/lib/sending-policy";
import type { schema } from "@/server/db";

import { getPolicyForOrganization } from "./sending-policy";

/**
 * How the sending engine applies the workspace's sending protection policy (read through the
 * deliverability service; a workspace without a row gets the defaults). Blocked messages use the
 * shared POLICY_BLOCK_REASONS so the sending-protection screen can count them.
 */
export type SendingPolicy = Omit<SendingPolicyView, "updatedAt" | "oneClickUnsubscribe">;

export async function sendingPolicyFor(organizationId: string): Promise<SendingPolicy> {
  return getPolicyForOrganization(organizationId);
}

/** Bounce guard needs this many recent sends before it judges a sequence. */
export const BOUNCE_GUARD_MIN_SAMPLE = 10;
/** Bounce guard looks at this many most recent sends. */
export const BOUNCE_GUARD_WINDOW = 100;

/** Gradual ramp: 20 a day on the first day, +10% a day after, never above the mailbox's own limit. */
export function rampLimit(dailyLimit: number, startedAt: Date, now = new Date()): number {
  const days = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 86_400_000));
  return Math.min(dailyLimit, Math.ceil(20 * 1.1 ** days));
}

/** Why the policy holds this contact's email back, or null when it may be sent. */
export function policyHoldReason(
  policy: Pick<SendingPolicy, "restrictUnverified" | "restrictCatchAll">,
  emailStatus: (typeof schema.contact.$inferSelect)["emailStatus"],
): string | null {
  if (policy.restrictUnverified && (emailStatus === "unverified" || emailStatus === "unknown")) {
    return POLICY_BLOCK_REASONS.unverified;
  }
  if (policy.restrictCatchAll && emailStatus === "catch_all") return POLICY_BLOCK_REASONS.catchAll;
  return null;
}
