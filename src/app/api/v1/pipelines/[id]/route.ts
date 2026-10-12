import { readJson, route } from "@/server/http/route";
import {
  deletePipeline,
  getPipeline,
  pipelineDeleteSchema,
  pipelineUpdateSchema,
  updatePipeline,
} from "@/server/services/pipelines";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ pipeline: await getPipeline(actor, params.id) }), {
  permission: "deal:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => ({
    pipeline: await updatePipeline(actor, params.id, pipelineUpdateSchema.parse(await readJson(req))),
  }),
  { permission: "pipeline:manage" },
);

/** Body (optional): `{ moveDealsToPipelineId }`, required when the pipeline still has deals. */
export const DELETE = route<Params>(
  async ({ req, actor, params }) => {
    await deletePipeline(actor, params.id, pipelineDeleteSchema.parse(await readJson(req)));
    return { deleted: true, id: params.id };
  },
  { permission: "pipeline:manage" },
);
