import { route } from "@/server/http/route";
import { archiveWorkflow } from "@/server/services/workflows";

type Params = { id: string };

/** Archive: stops enrolling and ends running and waiting runs. */
export const POST = route<Params>(
  async ({ actor, params }) => ({ workflow: await archiveWorkflow(actor, params.id) }),
  {
    permission: "workflow:update",
  },
);
