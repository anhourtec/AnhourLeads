import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "@/lib/pipeline-constants";
import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { pageFrom, pagination } from "@/server/http/route";
import { log } from "@/server/log";
import { searchMembers } from "@/server/services/members";
import { searchTasks, type TaskSearch } from "@/server/services/tasks";

import { ErrorState } from "../_components/pipeline/error-state";
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
  const view = one("view") === "all" ? "all" : "mine";
  const statusParam = one("status");
  const status = statusParam === "any" ? undefined : (pick(TASK_STATUSES, statusParam) ?? "open");
  const type = pick(TASK_TYPES, one("type"));
  const priority = pick(TASK_PRIORITIES, one("priority"));
  const q = one("q")?.slice(0, 200);
  const assigneeId = view === "all" ? one("assignee") : undefined;
  const page = pageFrom({ page: one("page"), per_page: 25 });

  const filters: TaskSearch = {
    mine: view === "mine",
    status: status ? [status] : undefined,
    type: type ? [type] : undefined,
    priority: priority ? [priority] : undefined,
    q: q ? q : undefined,
    assigneeId: assigneeId ? assigneeId : undefined,
    sort: one("sort") === "priority" ? "priority" : undefined,
  };

  const loaded = await Promise.all([
    searchTasks(actor, filters, page),
    searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
  ]).catch((error: unknown) => {
    log.error("tasks failed to load", { component: "tasks", error });
    return null;
  });

  if (!loaded) return <ErrorState />;
  const [result, members] = loaded;
  return (
    <TasksView
      tasks={result.tasks}
      pagination={pagination(page, result.total)}
      members={members.users.map((m) => ({ id: m.id, name: m.name, email: m.email }))}
      currentUserId={context.user.id}
      role={actor.role}
      view={view}
      now={new Date().toISOString()}
    />
  );
}
