import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { conflict } from "@/server/http/errors";

import { audit } from "./audit";
import { updateOnboarding } from "./onboarding";

/**
 * Anti-spam acknowledgement ("I will comply"). Stored per user and workspace on onboarding_state.
 * It is required before creating a sequence only for people who went through onboarding in this
 * workspace (their row is still open, or it finished through the flow and recorded an outcome) and
 * haven't accepted it. Accounts without a row, rows created only to save preferences (seeded and
 * older accounts) and API keys are not asked.
 */

export const antiSpamSchema = z
  .object({ accepted: z.literal(true, { error: "Accept the acknowledgement to continue." }) })
  .strict();

export interface AntiSpamState {
  required: boolean;
  acceptedAt: string | null;
}

async function row(actor: Pick<Actor, "organizationId" | "userId">) {
  if (!actor.userId) return null;
  const [r] = await db
    .select({
      id: schema.onboardingState.id,
      acceptedAt: schema.onboardingState.antiSpamAcceptedAt,
      finishedAt: schema.onboardingState.finishedAt,
      completedSteps: schema.onboardingState.completedSteps,
    })
    .from(schema.onboardingState)
    .where(
      and(
        eq(schema.onboardingState.organizationId, actor.organizationId),
        eq(schema.onboardingState.userId, actor.userId),
      ),
    )
    .limit(1);
  return r ?? null;
}

export async function antiSpamState(actor: Pick<Actor, "organizationId" | "userId">): Promise<AntiSpamState> {
  const r = await row(actor);
  const onboarded = Boolean(r && (!r.finishedAt || r.completedSteps.length > 0));
  return { required: Boolean(r && onboarded && !r.acceptedAt), acceptedAt: r?.acceptedAt?.toISOString() ?? null };
}

export async function acceptAntiSpam(actor: Actor, input: unknown): Promise<AntiSpamState> {
  antiSpamSchema.parse(input);
  // The onboarding service owns the row: it creates it (finished) for people who never onboarded
  // and keeps the first acceptance time as consent evidence. API keys get 403 there.
  await updateOnboarding(actor, { antiSpamAccepted: true });
  await audit(actor, "consent.anti_spam", "user", actor.userId);
  return antiSpamState(actor);
}

/** Throw 409 when this person must accept the acknowledgement before creating a sequence. */
export async function assertAntiSpamAccepted(actor: Pick<Actor, "organizationId" | "userId">): Promise<void> {
  if ((await antiSpamState(actor)).required) throw conflict("Accept the anti-spam acknowledgement first.");
}
