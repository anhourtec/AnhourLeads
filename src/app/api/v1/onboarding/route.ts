import { forbidden } from "@/server/http/errors";
import { readJson, route } from "@/server/http/route";
import { getOnboarding, onboardingPatchSchema, startOnboarding, updateOnboarding } from "@/server/services/onboarding";

/** The signed-in person's own onboarding state in the active workspace. */
export const GET = route(async ({ actor }) => ({ onboarding: await getOnboarding(actor) }));

/** Start onboarding after joining a workspace (idempotent; viewers start finished). */
export const POST = route(async ({ actor }) => {
  if (actor.kind !== "user" || !actor.userId) throw forbidden("Onboarding belongs to a signed-in person.");
  await startOnboarding(actor.organizationId, actor.userId, actor.role);
  return { onboarding: await getOnboarding(actor) };
});

/** Save answers, the anti-spam acknowledgement, finishing or skipping, the hub card and the home layout. */
export const PATCH = route(async ({ req, actor }) => {
  const patch = onboardingPatchSchema.parse(await readJson(req));
  return { onboarding: await updateOnboarding(actor, patch) };
});
