import "server-only";

import { and, count, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";

import {
  AUTO_PAUSE_AUDIT_ACTION,
  DEFAULT_SENDING_POLICY,
  POLICY_BLOCK_PREFIX,
  type SendingPolicyView,
} from "@/lib/sending-policy";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import type { Page } from "@/server/http/route";
import { audit } from "@/server/services/audit";

import { unprocessable } from "./records";

/**
 * Sending protection settings (email setup and health → sending protection). This module owns the
 * settings, counters and bounce logs; the sending engine reads the policy with
 * getPolicyForOrganization() and enforces it.
 */

type PolicyRow = typeof schema.sendingPolicy.$inferSelect;

function toView(row: PolicyRow | undefined): SendingPolicyView {
  if (!row) return { ...DEFAULT_SENDING_POLICY, updatedAt: null };
  return {
    autoPauseOnAuthIssue: row.autoPauseOnAuthIssue,
    restrictUnverified: row.restrictUnverified,
    restrictCatchAll: row.restrictCatchAll,
    requireSignature: row.requireSignature,
    oneClickUnsubscribe: true,
    gradualRamp: row.gradualRamp,
    bounceGuard: row.bounceGuard,
    bounceThreshold: row.bounceThreshold,
    workspaceDailyLimit: row.workspaceDailyLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The workspace's policy, or the defaults when it was never changed. For the sending engine. */
export async function getPolicyForOrganization(organizationId: string): Promise<SendingPolicyView> {
  const [row] = await db
    .select()
    .from(schema.sendingPolicy)
    .where(eq(schema.sendingPolicy.organizationId, organizationId))
    .limit(1);
  return toView(row);
}

export async function getSendingPolicy(actor: Pick<Actor, "organizationId">): Promise<SendingPolicyView> {
  return getPolicyForOrganization(actor.organizationId);
}

export const sendingPolicyPatch = z
  .object({
    autoPauseOnAuthIssue: z.boolean().optional(),
    restrictUnverified: z.boolean().optional(),
    restrictCatchAll: z.boolean().optional(),
    requireSignature: z.boolean().optional(),
    oneClickUnsubscribe: z.boolean().optional(),
    gradualRamp: z.boolean().optional(),
    bounceGuard: z.boolean().optional(),
    bounceThreshold: z
      .number()
      .min(0.01, "Use a bounce threshold between 1% and 50%.")
      .max(0.5, "Use a bounce threshold between 1% and 50%.")
      .optional(),
    workspaceDailyLimit: z
      .number()
      .int("Use a whole number.")
      .min(1, "Use a limit between 1 and 100,000, or leave it empty.")
      .max(100_000, "Use a limit between 1 and 100,000, or leave it empty.")
      .nullable()
      .optional(),
  })
  .strict();

type PolicyKey = Exclude<keyof z.infer<typeof sendingPolicyPatch>, "oneClickUnsubscribe">;

export async function updateSendingPolicy(actor: Actor, patch: z.infer<typeof sendingPolicyPatch>) {
  if (patch.oneClickUnsubscribe === false) {
    throw unprocessable("One-click unsubscribe is always on and can't be turned off.", "oneClickUnsubscribe");
  }
  const before = await getSendingPolicy(actor);
  const { oneClickUnsubscribe: _always, ...values } = patch;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(values) as [PolicyKey, unknown][]) {
    if (value !== undefined && before[key] !== value) changes[key] = { from: before[key], to: value };
  }
  if (!Object.keys(changes).length) return before;
  const set = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])) as Partial<PolicyRow>;
  await db
    .insert(schema.sendingPolicy)
    .values({ organizationId: actor.organizationId, ...set })
    .onConflictDoUpdate({ target: schema.sendingPolicy.organizationId, set: { ...set, updatedAt: new Date() } });
  await audit(actor, "sending_policy.update", "sending_policy", actor.organizationId, { changes });
  return getSendingPolicy(actor);
}

/* -------------------------------------------------------------------------- */
/* Counters and bounce logs                                                    */
/* -------------------------------------------------------------------------- */

export interface ProtectionCounters {
  /** Messages held back by a policy rule, last 30 days. */
  riskySendsHeldBack: number;
  /** Every message blocked before sending (policy, suppression, invalid address…), last 30 days. */
  blockedMessages: number;
  /** Distinct contacts those blocked messages were for. */
  contactsScreened: number;
  /** Sequences paused automatically (bounce guard, authentication), last 30 days. */
  sequencesAutoPaused: number;
  bounced: number;
  days: number;
}

export async function protectionCounters(actor: Pick<Actor, "organizationId">, days = 30): Promise<ProtectionCounters> {
  const since = new Date(Date.now() - days * 864e5);
  const o = schema.outboundMessage;
  const [[blocked], [paused]] = await Promise.all([
    db
      .select({
        policy: sql<number>`count(*) filter (where ${o.status} = 'blocked' and ${o.blockedReason} like ${`${POLICY_BLOCK_PREFIX}%`})::int`,
        blocked: sql<number>`count(*) filter (where ${o.status} = 'blocked')::int`,
        contacts: sql<number>`count(distinct ${o.contactId}) filter (where ${o.status} = 'blocked')::int`,
        bounced: sql<number>`count(*) filter (where ${o.status} = 'bounced')::int`,
      })
      .from(o)
      .where(and(eq(o.organizationId, actor.organizationId), gte(sql`coalesce(${o.sentAt}, ${o.createdAt})`, since))),
    db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, actor.organizationId),
          eq(schema.auditLog.action, AUTO_PAUSE_AUDIT_ACTION),
          gte(schema.auditLog.createdAt, since),
        ),
      ),
  ]);
  return {
    riskySendsHeldBack: Number(blocked?.policy ?? 0),
    blockedMessages: Number(blocked?.blocked ?? 0),
    contactsScreened: Number(blocked?.contacts ?? 0),
    sequencesAutoPaused: paused?.n ?? 0,
    bounced: Number(blocked?.bounced ?? 0),
    days,
  };
}

export const bounceLogQuery = z.object({
  status: z.enum(["bounced", "blocked", "all"]).default("all"),
  policyOnly: z.preprocess((v) => v === "true" || v === true, z.boolean()).default(false),
});

export interface BounceLogEntry {
  id: string;
  toEmail: string;
  subject: string;
  status: "bounced" | "blocked";
  reason: string | null;
  policy: boolean;
  mailboxEmail: string | null;
  contactId: string | null;
  at: string;
}

export async function bounceLogs(
  actor: Pick<Actor, "organizationId">,
  query: z.infer<typeof bounceLogQuery>,
  page: Page,
): Promise<{ entries: BounceLogEntry[]; total: number }> {
  const o = schema.outboundMessage;
  const statuses: Array<"bounced" | "blocked"> = query.status === "all" ? ["bounced", "blocked"] : [query.status];
  const where = and(
    eq(o.organizationId, actor.organizationId),
    inArray(o.status, statuses),
    query.policyOnly ? like(o.blockedReason, `${POLICY_BLOCK_PREFIX}%`) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: o.id,
        toEmail: o.toEmail,
        subject: o.subject,
        status: o.status,
        blockedReason: o.blockedReason,
        error: o.error,
        contactId: o.contactId,
        sentAt: o.sentAt,
        createdAt: o.createdAt,
        mailboxEmail: schema.mailbox.email,
      })
      .from(o)
      .leftJoin(schema.mailbox, eq(schema.mailbox.id, o.mailboxId))
      .where(where)
      .orderBy(desc(sql`coalesce(${o.sentAt}, ${o.createdAt})`))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: count() }).from(o).where(where),
  ]);
  return {
    entries: rows.map((r) => ({
      id: r.id,
      toEmail: r.toEmail,
      subject: r.subject,
      status: r.status === "bounced" ? "bounced" : "blocked",
      reason: r.blockedReason ?? (r.status === "bounced" ? "The receiving server rejected the message." : null),
      policy: Boolean(r.blockedReason?.startsWith(POLICY_BLOCK_PREFIX)),
      mailboxEmail: r.mailboxEmail,
      contactId: r.contactId,
      at: (r.sentAt ?? r.createdAt).toISOString(),
    })),
    total: total?.n ?? 0,
  };
}
