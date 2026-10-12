import { LIMITS } from "@/server/http/rate-limit";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { searchTasks, taskSearchSchema } from "@/server/services/tasks";

/** Search tasks. Filters: mine, assigneeId, status, type, priority, contactId, companyId, dueAfter, dueBefore, q. */
export const POST = route(
  async ({ req, actor }) => {
    const body = taskSearchSchema.parse(await readJson(req));
    const page = pageFrom(body);
    const { tasks, total } = await searchTasks(actor, body, page);
    return { tasks, pagination: pagination(page, total) };
  },
  { permission: "task:read", limit: LIMITS.read },
);
