import { route } from "@/server/http/route";
import { taskCounts, taskCountsSchema } from "@/server/services/tasks";

/** Counts for the task tabs: all, call, email, LinkedIn and overdue (`mine=true`, `assigneeId`, `status`). */
export const GET = route(
  async ({ req, actor }) => {
    const p = req.nextUrl.searchParams;
    const input = taskCountsSchema.parse({
      mine: p.get("mine") === "true" ? true : undefined,
      assigneeId: p.get("assigneeId") || undefined,
      status: p.getAll("status").length ? p.getAll("status") : undefined,
    });
    return { counts: await taskCounts(actor, input) };
  },
  { permission: "task:read" },
);
