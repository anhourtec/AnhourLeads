import { route } from "@/server/http/route";
import { pauseWorkflow } from "@/server/services/workflows";

type Params = { id: string };

export const POST = route<Params>(async ({ actor, params }) => ({ workflow: await pauseWorkflow(actor, params.id) }), {
  permission: "workflow:launch",
});
