import { readJson, route } from "@/server/http/route";
import { logCall, logCallSchema } from "@/server/services/tasks";

/** Call session: record the outcome of a call, complete the task and log the call on the contact. */
export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => ({
    task: await logCall(actor, params.id, logCallSchema.parse(await readJson(req))),
  }),
  { permission: "task:update" },
);
