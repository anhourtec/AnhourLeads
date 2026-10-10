import { readJson, route } from "@/server/http/route";
import { deleteSequence, getSequence, updateSequence } from "@/server/services/sequences";

type P = { id: string };

export const GET = route<P>(
  async ({ actor, params }) => {
    const { sequence, steps } = await getSequence(actor, params.id);
    return { emailer_campaign: sequence, emailer_steps: steps };
  },
  { permission: "sequence:read" },
);

/** Settings: name, mailbox, tracking, stop on reply, review mode. Steps have their own endpoints. */
export const PATCH = route<P>(
  async ({ req, actor, params }) => {
    const { sequence, steps } = await updateSequence(actor, params.id, await readJson(req));
    return { emailer_campaign: sequence, emailer_steps: steps };
  },
  { permission: "sequence:update" },
);

export const DELETE = route<P>(
  async ({ actor, params }) => {
    await deleteSequence(actor, params.id);
    return { deleted: true };
  },
  { permission: "sequence:delete" },
);
