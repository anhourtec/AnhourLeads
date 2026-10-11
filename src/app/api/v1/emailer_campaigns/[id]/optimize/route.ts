import { route } from "@/server/http/route";
import { optimizeSequence } from "@/server/services/sequence-insights";

/** Suggestions from the steps' content and spacing (subject length, personalisation, spacing, calls). */
export const GET = route<{ id: string }>(
  async ({ actor, params }) => ({ suggestions: await optimizeSequence(actor, params.id) }),
  { permission: "sequence:read" },
);
