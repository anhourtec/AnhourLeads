import { readJson, route } from "@/server/http/route";
import { testWorkflow, workflowTestSchema } from "@/server/services/workflows";

type Params = { id: string };

/** Dry run against one record: the path it would take. Nothing is changed. */
export const POST = route<Params>(
  async ({ req, actor, params }) => ({
    test: await testWorkflow(actor, params.id, workflowTestSchema.parse(await readJson(req))),
  }),
  { permission: "workflow:read" },
);
