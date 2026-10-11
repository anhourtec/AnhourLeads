import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/pipeline-constants";
import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { pageFrom, pagination } from "@/server/http/route";
import { log } from "@/server/log";
import { searchMembers } from "@/server/services/members";
import { searchTasks, type TaskSearch, taskCounts } from "@/server/services/tasks";

import { ErrorState } from "../_components/pipeline/error-state";
import { TASK_SORTS, TASK_TABS, type TaskSort, type TaskTab } from "./_components/task-view-config";
import { TasksView } from "./_components/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

const pick = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  values.find((v) => v === value);

export default async function TasksPage({ searchParams }: PageProps<"/dashboard/tasks">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "task:read")) notFound();

  const sp = await searchParams;
  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);
  // `view=all` is the older spelling of the team scope.
  const scope = one("scope") === "team" || one("view") === "all" ? "team" : "mine";
  const tab: TaskTab = pick(TASK_TABS, one("tab")) ?? "all";
  const statusParam = one("status");
  const status = statusParam === "any" ? undefined : (pick(TASK_STATUSES, statusParam) ?? "open");
  const priority = pick(TASK_PRIORITIES, one("priority"));
  const q = one("q")?.slice(0, 200);
  const assigneeId = scope === "team" ? one("assignee") : undefined;
  const sort: TaskSort = pick(TASK_SORTS, one("sort")) ?? "due_at";
  const page = pageFrom({ page: one("page"), per_page: 25 });

  const filters: TaskSearch = {
    mine: scope === "mine",
    tab,
    status: status && tab !== "overdue" ? [status] : undefined,
    priority: priority ? [priority] : undefined,
    q: q ? q : undefined,
    assigneeId: assigneeId ? assigneeId : undefined,
    sort,
  };

  const loaded = await Promise.all([
    searchTasks(actor, filters, page),
    taskCounts(actor, {
      mine: scope === "mine",
      assigneeId: assigneeId ? assigneeId : undefined,
      status: status ? [status] : undefined,
    }),
    searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
  ]).catch((error: unknown) => {
    log.error("tasks failed to load", { component: "tasks", error });
    return null;
  });

  if (!loaded) return <ErrorState />;
  const [result, counts, members] = loaded;
  return (
    <TasksView
      tasks={result.tasks}
      counts={counts}
      pagination={pagination(page, result.total)}
      members={members.users.map((m) => ({ id: m.id, name: m.name, email: m.email }))}
      currentUserId={context.user.id}
      role={actor.role}
      scope={scope}
      tab={tab}
      sort={sort}
    />
  );
}
