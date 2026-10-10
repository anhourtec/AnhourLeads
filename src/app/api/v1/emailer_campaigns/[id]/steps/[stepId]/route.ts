import { readJson, route } from "@/server/http/route";
import { deleteStep, updateStep } from "@/server/services/sequences";

type P = { id: string; stepId: string };

export const PATCH = route<P>(
  async ({ req, actor, params }) => ({
    emailer_steps: await updateStep(actor, params.id, params.stepId, await readJson(req)),
  }),
  { permission: "sequence:update" },
);

export const DELETE = route<P>(
  async ({ actor, params }) => ({ emailer_steps: await deleteStep(actor, params.id, params.stepId) }),
  { permission: "sequence:update" },
);
