import { readJson, route } from "@/server/http/route";
import { draftStepEmail } from "@/server/services/sequence-drafts";

/** Draft one email (Assisted or Prompt mode). Uses the AI provider when configured, else templates. */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => ({ draft: await draftStepEmail(actor, params.id, await readJson(req)) }),
  { permission: "sequence:update" },
);
