import { readJson, route } from "@/server/http/route";
import { listStageTriggers, stageTriggersUpdateSchema, updateStageTriggers } from "@/server/services/stage-triggers";

export const GET = route(async ({ actor }) => ({ stage_triggers: await listStageTriggers(actor) }), {
  permission: "contact:read",
});

export const PUT = route(
  async ({ req, actor }) => ({
    stage_triggers: await updateStageTriggers(actor, stageTriggersUpdateSchema.parse(await readJson(req))),
  }),
  { permission: "stage:manage" },
);
