import { readJson, route } from "@/server/http/route";
import { deleteTask, getTask, taskUpdateSchema, updateTask } from "@/server/services/tasks";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ task: await getTask(actor, params.id) }), {
  permission: "task:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => ({
    task: await updateTask(actor, params.id, taskUpdateSchema.parse(await readJson(req))),
  }),
  { permission: "task:update" },
);

export const DELETE = route<Params>(
  async ({ actor, params }) => {
    await deleteTask(actor, params.id);
    return { deleted: true, id: params.id };
  },
  { permission: "task:delete" },
);
