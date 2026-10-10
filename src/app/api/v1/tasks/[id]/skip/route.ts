import { readJson, route } from "@/server/http/route";
import { resolveTask, taskResolveSchema } from "@/server/services/tasks";

export const POST = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const { note } = taskResolveSchema.parse(await readJson(req));
    return { task: await resolveTask(actor, params.id, "skipped", note) };
  },
  { permission: "task:update" },
);
