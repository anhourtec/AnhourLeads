"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Check, CheckSquare, EllipsisVertical, Pencil, Plus, Search, SkipForward, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTime } from "@/lib/format-display";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  TASK_TYPE_LABELS,
  TASK_TYPES,
} from "@/lib/pipeline-constants";
import { can, type Role } from "@/lib/rbac/permissions";
import type { TaskDto } from "@/server/services/tasks";

import { ConfirmDialog } from "../../_components/pipeline/confirm-dialog";
import { ListPagination } from "../../_components/pipeline/list-pagination";
import { PageHeader } from "../../_components/pipeline/page-header";
import { PriorityPill, TaskStatusPill } from "../../_components/pipeline/pills";
import { useUrlFilters } from "../../_components/pipeline/use-url-filters";
import { TaskDialog } from "./task-dialog";
import type { MemberOption, PaginationInfo } from "./types";

function startOfUtcDay(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface RowActionsProps {
  task: TaskDto;
  busy: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onResolve: (task: TaskDto, outcome: "complete" | "skip") => void;
  onEdit: (task: TaskDto) => void;
  onReopen: (task: TaskDto) => void;
  onDelete: (task: TaskDto) => void;
}

function RowActions({ task, busy, canUpdate, canDelete, onResolve, onEdit, onReopen, onDelete }: RowActionsProps) {
  const open = task.status === "open";
  return (
    <div className="flex items-center justify-end gap-1">
      {canUpdate && open ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onResolve(task, "complete")}
            aria-label={`Complete ${task.title}`}
          >
            <Check data-icon="inline-start" />
            Complete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onResolve(task, "skip")}
            aria-label={`Skip ${task.title}`}
          >
            <SkipForward data-icon="inline-start" />
            Skip
          </Button>
        </>
      ) : null}
      {canUpdate || canDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${task.title}`}>
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate ? (
              <DropdownMenuItem onSelect={() => onEdit(task)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
            ) : null}
            {canUpdate && !open ? (
              <DropdownMenuItem onSelect={() => onReopen(task)}>
                <CheckSquare />
                Reopen
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function Due({ task, overdue }: { task: TaskDto; overdue: boolean }) {
  if (!task.dueAt) return <span className="text-muted-foreground">No due date</span>;
  return (
    <time dateTime={task.dueAt} title={formatDateTime(task.dueAt)} className={overdue ? "text-destructive" : ""}>
      {formatDate(task.dueAt)}
    </time>
  );
}

function emptyMessage(hasFilters: boolean, view: "mine" | "all"): string {
  if (hasFilters) return "Try a different search or clear the filters.";
  return view === "mine" ? "Tasks assigned to you show up here." : "Tasks for everyone in the workspace show up here.";
}

export function TasksView({
  tasks,
  pagination,
  members,
  currentUserId,
  role,
  view,
  now,
}: {
  readonly tasks: TaskDto[];
  readonly pagination: PaginationInfo;
  readonly members: MemberOption[];
  readonly currentUserId: string;
  readonly role: Role;
  readonly view: "mine" | "all";
  readonly now: string;
}) {
  const router = useRouter();
  const filters = useUrlFilters();
  const [dialog, setDialog] = useState<{ open: boolean; task: TaskDto | null }>({ open: false, task: null });
  const [toDelete, setToDelete] = useState<TaskDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState(filters.get("q"));

  const canCreate = can(role, "task:create");
  const canUpdate = can(role, "task:update");
  const canDelete = can(role, "task:delete");
  const today = startOfUtcDay(now);
  const isOverdue = (t: TaskDto) =>
    t.status === "open" && Boolean(t.dueAt) && new Date(t.dueAt ?? "").getTime() < today;
  const statusValue = filters.get("status") || "open";
  const hasFilters = Boolean(
    filters.get("q") || filters.get("type") || filters.get("priority") || filters.get("assignee"),
  );

  async function resolve(task: TaskDto, outcome: "complete" | "skip") {
    setBusyId(task.id);
    const res = await apiFetch(`/api/v1/tasks/${task.id}/${outcome}`, { method: "POST", body: {} });
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(outcome === "complete" ? "Task completed" : "Task skipped");
    router.refresh();
  }

  async function reopen(task: TaskDto) {
    const res = await apiFetch(`/api/v1/tasks/${task.id}`, { method: "PATCH", body: { status: "open" } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Task reopened");
    router.refresh();
  }

  const actionProps = {
    canUpdate,
    canDelete,
    onResolve: (task: TaskDto, outcome: "complete" | "skip") => void resolve(task, outcome),
    onEdit: (task: TaskDto) => setDialog({ open: true, task }),
    onReopen: (task: TaskDto) => void reopen(task),
    onDelete: (task: TaskDto) => setToDelete(task),
  };

  async function remove(): Promise<boolean> {
    if (!toDelete) return true;
    const res = await apiFetch(`/api/v1/tasks/${toDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success("Task deleted");
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Tasks"
        description="Calls, emails and follow-ups for you and your team."
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setDialog({ open: true, task: null })}>
              <Plus data-icon="inline-start" />
              New task
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3">
        <Tabs value={view} onValueChange={(v) => filters.set({ view: v === "all" ? "all" : null, assignee: null })}>
          <TabsList>
            <TabsTrigger value="mine">My tasks</TabsTrigger>
            <TabsTrigger value="all">All tasks</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <form
            className="w-full lg:max-w-xs"
            onSubmit={(e) => {
              e.preventDefault();
              filters.set({ q: query.trim() || null });
            }}
          >
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search tasks"
                placeholder="Search titles and notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </form>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <NativeSelect
              size="sm"
              aria-label="Status"
              value={statusValue}
              onChange={(e) => filters.set({ status: e.target.value === "open" ? null : e.target.value })}
              className="w-full sm:w-36"
            >
              {TASK_STATUSES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="any">Any status</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              size="sm"
              aria-label="Type"
              value={filters.get("type")}
              onChange={(e) => filters.set({ type: e.target.value })}
              className="w-full sm:w-36"
            >
              <NativeSelectOption value="">Any type</NativeSelectOption>
              {TASK_TYPES.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              size="sm"
              aria-label="Priority"
              value={filters.get("priority")}
              onChange={(e) => filters.set({ priority: e.target.value })}
              className="w-full sm:w-36"
            >
              <NativeSelectOption value="">Any priority</NativeSelectOption>
              {TASK_PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {view === "all" ? (
              <NativeSelect
                size="sm"
                aria-label="Assignee"
                value={filters.get("assignee")}
                onChange={(e) => filters.set({ assignee: e.target.value })}
                className="w-full sm:w-44"
              >
                <NativeSelectOption value="">Anyone</NativeSelectOption>
                {members.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3" aria-busy={filters.pending}>
        {tasks.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckSquare aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{hasFilters ? "No tasks match these filters" : "No tasks here"}</EmptyTitle>
              <EmptyDescription>{emptyMessage(hasFilters, view)}</EmptyDescription>
            </EmptyHeader>
            {canCreate && !hasFilters ? (
              <EmptyContent>
                <Button size="sm" onClick={() => setDialog({ open: true, task: null })}>
                  <Plus data-icon="inline-start" />
                  New task
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <>
            <ul className="flex flex-col gap-2 md:hidden" aria-label="Tasks">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words font-medium text-sm">{task.title}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {TASK_TYPE_LABELS[task.type]}
                        {task.contact ? ` · ${task.contact.name}` : ""}
                        {task.company ? ` · ${task.company.name}` : ""}
                      </span>
                    </div>
                    <TaskStatusPill status={task.status} overdue={isOverdue(task)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <PriorityPill priority={task.priority} />
                    <span className="text-muted-foreground">
                      <Due task={task} overdue={isOverdue(task)} />
                    </span>
                    {view === "all" && task.assignee ? (
                      <span className="text-muted-foreground">· {task.assignee.name}</span>
                    ) : null}
                  </div>
                  <RowActions task={task} busy={busyId === task.id} {...actionProps} />
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-xl border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Task</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Due</TableHead>
                    {view === "all" ? <TableHead>Assignee</TableHead> : null}
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="max-w-80 pl-4">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate font-medium">{task.title}</span>
                          {task.contact || task.company ? (
                            <span className="truncate text-muted-foreground text-xs">
                              {[task.contact?.name, task.company?.name].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{TASK_TYPE_LABELS[task.type]}</TableCell>
                      <TableCell>
                        <PriorityPill priority={task.priority} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <Due task={task} overdue={isOverdue(task)} />
                      </TableCell>
                      {view === "all" ? (
                        <TableCell className="max-w-44 truncate">
                          {task.assignee?.id === currentUserId ? "You" : (task.assignee?.name ?? "Unassigned")}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <TaskStatusPill status={task.status} overdue={isOverdue(task)} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <RowActions task={task} busy={busyId === task.id} {...actionProps} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <ListPagination
          page={pagination.page}
          totalPages={pagination.total_pages}
          total={pagination.total_entries}
          noun={pagination.total_entries === 1 ? "task" : "tasks"}
        />
      </div>

      <TaskDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        task={dialog.task}
        members={members}
        defaultAssigneeId={currentUserId}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this task?"
        description={`"${toDelete?.title ?? ""}" will be removed for everyone. This can't be undone.`}
        confirmLabel="Delete task"
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" />}
        onConfirm={remove}
      />
    </div>
  );
}
