import { readJson, route } from "@/server/http/route";
import { replaceStages, stagesReplaceSchema } from "@/server/services/pipelines";

type Params = { id: string };

/** Replace the ordered stage list. `moveDealsTo` maps each removed stage that has deals to a kept stage. */
export const PUT = route<Params>(
  async ({ req, actor, params }) => ({
    pipeline: await replaceStages(actor, params.id, stagesReplaceSchema.parse(await readJson(req))),
  }),
  { permission: "pipeline:manage" },
);
