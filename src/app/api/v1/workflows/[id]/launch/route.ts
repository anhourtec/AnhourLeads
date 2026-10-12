import { route } from "@/server/http/route";
import { launchWorkflow } from "@/server/services/workflows";

type Params = { id: string };

/** Validate and activate. Runs act with the launching member's permissions from now on. */
export const POST = route<Params>(async ({ actor, params }) => ({ workflow: await launchWorkflow(actor, params.id) }), {
  permission: "workflow:launch",
});
