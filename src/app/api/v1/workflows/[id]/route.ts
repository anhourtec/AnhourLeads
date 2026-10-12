import { readJson, route } from "@/server/http/route";
import { deleteWorkflow, getWorkflow, updateWorkflow, workflowUpdateSchema } from "@/server/services/workflows";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ workflow: await getWorkflow(actor, params.id) }), {
  permission: "workflow:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => ({
    workflow: await updateWorkflow(actor, params.id, workflowUpdateSchema.parse(await readJson(req))),
  }),
  { permission: "workflow:update" },
);

export const DELETE = route<Params>(
  async ({ actor, params }) => {
    await deleteWorkflow(actor, params.id);
    return { deleted: true, id: params.id };
  },
  { permission: "workflow:delete" },
);
