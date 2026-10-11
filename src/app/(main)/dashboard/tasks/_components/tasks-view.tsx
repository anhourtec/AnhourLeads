"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ArrowDownUp,
  Check,
  CheckSquare,
  EllipsisVertical,
  Filter,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings2,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
} from "@/lib/pipeline-constants";
import { can, type Role } from "@/lib/rbac/permissions";
import type { TaskCounts, TaskDto } from "@/server/services/tasks";

import { ConfirmDialog } from "../../_components/pipeline/confirm-dialog";
import { ListPagination } from "../../_components/pipeline/list-pagination";
import { PageHeader } from "../../_components/pipeline/page-header";
import { PriorityPill, TaskStatusPill } from "../../_components/pipeline/pills";
import { useUrlFilters } from "../../_components/pipeline/use-url-filters";
import { CallSession } from "./call-session";
import { TaskDialog } from "./task-dialog";
import {
  TASK_SORT_LABELS,
  TASK_SORTS,
  TASK_TAB_LABELS,
  TASK_TABS,
  TASK_TYPE_ICONS,
  type TaskSort,
  type TaskTab,
} from "./task-view-config";
import type { MemberOption, PaginationInfo } from "./types";

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
            <Check data-icon="inline-start" aria-hidden="true" />
            Complete
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onResolve(task, "skip")}
            aria-label={`Skip ${task.title}`}
          >
            <SkipForward aria-hidden="true" />
          </Button>
        </>
      ) : null}
      {canUpdate || canDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${task.title}`}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate ? (
              <DropdownMenuItem onSelect={() => onEdit(task)}>
                <Pencil aria-hidden="true" />
                Edit
              </DropdownMenuItem>
            ) : null}
            {canUpdate && !open ? (
              <DropdownMenuItem onSelect={() => onReopen(task)}>
                <CheckSquare aria-hidden="true" />
                Reopen
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                  <Trash2 aria-hidden="true" />
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

function Due({ task }: { task: TaskDto }) {
  if (!task.dueAt) return <span className="text-muted-foreground">No due date</span>;
  return (
    <time dateTime={task.dueAt} title={formatDateTime(task.dueAt)} className={task.overdue ? "text-destructive" : ""}>
      {formatDate(task.dueAt)}
    </time>
  );
}

function TypeIcon({ task }: { task: TaskDto }) {
  const Icon = TASK_TYPE_ICONS[task.type];
  return (
    <span className="flex size-7 items-center justify-center rounded-md bg-muted" title={TASK_TYPE_LABELS[task.type]}>
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{TASK_TYPE_LABELS[task.type]}</span>
    </span>
  );
}

export function TasksView({
  tasks,
  counts,
  pagination,
  members,
  currentUserId,
  role,
  scope,
  tab,
  sort,
}: {
  readonly tasks: TaskDto[];
  readonly counts: TaskCounts;
  readonly pagination: PaginationInfo;
  readonly members: MemberOption[];
  readonly currentUserId: string;
  readonly role: Role;
  readonly scope: "mine" | "team";
  readonly tab: TaskTab;
  readonly sort: TaskSort;
}) {
  const router = useRouter();
  const filters = useUrlFilters();
  const [dialog, setDialog] = useState<{ open: boolean; task: TaskDto | null }>({ open: false, task: null });
  const [toDelete, setToDelete] = useState<TaskDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState(filters.get("q"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [session, setSession] = useState(false);

  const canCreate = can(role, "task:create");
  const canUpdate = can(role, "task:update");
  const canDelete = can(role, "task:delete");
  const statusValue = filters.get("status") || "open";
  const compact = filters.get("density") === "compact";
  const activeFilters = [filters.get("status"), filters.get("priority"), filters.get("assignee")].filter(
    Boolean,
  ).length;
  const hasFilters = Boolean(filters.get("q")) || activeFilters > 0;
  const openOnPage = tasks.filter((t) => t.status === "open");
  const allSelected = openOnPage.length > 0 && openOnPage.every((t) => selected.has(t.id));

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

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

  async function bulk(outcome: "complete" | "skip") {
    const ids = [...selected];
    setBusyId("bulk");
    const results = await Promise.all(
      ids.map((id) => apiFetch(`/api/v1/tasks/${id}/${outcome}`, { method: "POST", body: {} })),
    );
    setBusyId(null);
    const failed = results.filter((r) => !r.ok).length;
    setSelected(new Set());
    if (failed) toast.error(`${failed} of ${ids.length} tasks couldn't be updated.`);
    else
      toast.success(
        `${ids.length} task${ids.length === 1 ? "" : "s"} ${outcome === "complete" ? "completed" : "skipped"}`,
      );
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

  const rowPad = compact ? "py-1" : "py-2.5";

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Tasks"
        actions={
          <>
            {canUpdate ? (
              <Button size="sm" variant="outline" onClick={() => setSession(true)}>
                <Phone data-icon="inline-start" aria-hidden="true" />
                Start call session
              </Button>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setDialog({ open: true, task: null })}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Create task
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Tabs value={tab} onValueChange={(v) => filters.set({ tab: v === "all" ? null : v })}>
            <TabsList>
              {TASK_TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TASK_TAB_LABELS[t]}
                  <span className="font-mono text-muted-foreground text-xs tabular-nums" data-testid={`count-${t}`}>
                    {counts[t]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <NativeSelect
              size="sm"
              aria-label="Task scope"
              value={scope}
              onChange={(e) =>
                filters.set({ scope: e.target.value === "team" ? "team" : null, view: null, assignee: null })
              }
              className="w-full sm:w-44"
            >
              <NativeSelectOption value="mine">All your tasks</NativeSelectOption>
              <NativeSelectOption value="team">All team tasks</NativeSelectOption>
            </NativeSelect>
            <form
              className="w-full sm:w-64"
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={showFilters ? "secondary" : "ghost"}
              aria-expanded={showFilters}
              aria-controls="task-filters"
              onClick={() => setShowFilters((v) => !v)}
            >
              <Filter data-icon="inline-start" aria-hidden="true" />
              {showFilters ? "Hide filters" : "Show filters"}
              {activeFilters ? <span className="font-mono text-xs tabular-nums">{activeFilters}</span> : null}
            </Button>
            <div className="flex items-center gap-1">
              <ArrowDownUp className="size-4 text-muted-foreground" aria-hidden="true" />
              <NativeSelect
                size="sm"
                aria-label="Sort"
                value={sort}
                onChange={(e) => filters.set({ sort: e.target.value === "due_at" ? null : e.target.value })}
                className="w-36"
              >
                {TASK_SORTS.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {TASK_SORT_LABELS[s]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Settings2 data-icon="inline-start" aria-hidden="true" />
                  View options
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>View options</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={statusValue === "any"}
                  onCheckedChange={(v) => filters.set({ status: v ? "any" : null })}
                >
                  Show completed and skipped
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={compact}
                  onCheckedChange={(v) => filters.set({ density: v ? "compact" : null })}
                >
                  Compact rows
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {showFilters ? (
          <div id="task-filters" className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-3 sm:grid-cols-3">
            <NativeSelect
              size="sm"
              aria-label="Status"
              value={statusValue}
              onChange={(e) => filters.set({ status: e.target.value === "open" ? null : e.target.value })}
              className="w-full"
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
              aria-label="Priority"
              value={filters.get("priority")}
              onChange={(e) => filters.set({ priority: e.target.value })}
              className="w-full"
            >
              <NativeSelectOption value="">Any priority</NativeSelectOption>
              {TASK_PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {scope === "team" ? (
              <NativeSelect
                size="sm"
                aria-label="Assignee"
                value={filters.get("assignee")}
                onChange={(e) => filters.set({ assignee: e.target.value })}
                className="w-full"
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
        ) : null}

        {selected.size && canUpdate ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-sm"
            role="toolbar"
            aria-label="Bulk actions"
          >
            <span className="font-medium tabular-nums">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={busyId === "bulk"} onClick={() => void bulk("complete")}>
              <Check data-icon="inline-start" aria-hidden="true" />
              Complete
            </Button>
            <Button size="sm" variant="outline" disabled={busyId === "bulk"} onClick={() => void bulk("skip")}>
              <SkipForward data-icon="inline-start" aria-hidden="true" />
              Skip
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X data-icon="inline-start" aria-hidden="true" />
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3" aria-busy={filters.pending}>
        {tasks.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckSquare aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                {hasFilters || tab !== "all" ? "No tasks match this view" : "You have no assigned tasks"}
              </EmptyTitle>
              <EmptyDescription>
                {hasFilters || tab !== "all"
                  ? "Try another tab or clear the filters."
                  : "Calls, emails and LinkedIn touches you need to do show up here, including the ones sequences create."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row flex-wrap justify-center">
              {scope === "mine" ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/tasks?scope=team">
                    <CheckSquare data-icon="inline-start" aria-hidden="true" />
                    View all team tasks
                  </Link>
                </Button>
              ) : null}
              {canCreate ? (
                <Button size="sm" onClick={() => setDialog({ open: true, task: null })}>
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  New task
                </Button>
              ) : null}
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <ul className="flex flex-col gap-2 md:hidden" aria-label="Tasks">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
                  <div className="flex items-start gap-2">
                    {canUpdate && task.status === "open" ? (
                      <Checkbox
                        className="mt-1"
                        aria-label={`Select ${task.title}`}
                        checked={selected.has(task.id)}
                        onCheckedChange={(v) => toggle(task.id, v === true)}
                      />
                    ) : null}
                    <TypeIcon task={task} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="break-words font-medium text-sm">{task.title}</span>
                      <span className="truncate text-muted-foreground text-xs">
                        {[task.contact?.name, task.company?.name].filter(Boolean).join(" · ") ||
                          TASK_TYPE_LABELS[task.type]}
                      </span>
                    </div>
                    <TaskStatusPill status={task.status} overdue={task.overdue} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <PriorityPill priority={task.priority} />
                    <span className="text-muted-foreground">
                      <Due task={task} />
                    </span>
                    {scope === "team" && task.assignee ? (
                      <span className="text-muted-foreground">· {task.assignee.name}</span>
                    ) : null}
                  </div>
                  <RowActions task={task} busy={busyId === task.id} {...actionProps} />
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
              <Table className="min-w-[860px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      {canUpdate ? (
                        <Checkbox
                          aria-label="Select all open tasks on this page"
                          checked={allSelected}
                          disabled={!openOnPage.length}
                          onCheckedChange={(v) =>
                            setSelected(v === true ? new Set(openOnPage.map((t) => t.id)) : new Set())
                          }
                        />
                      ) : null}
                    </TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Type</span>
                    </TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id} data-state={selected.has(task.id) ? "selected" : undefined}>
                      <TableCell className={`pl-4 ${rowPad}`}>
                        {canUpdate && task.status === "open" ? (
                          <Checkbox
                            aria-label={`Select ${task.title}`}
                            checked={selected.has(task.id)}
                            onCheckedChange={(v) => toggle(task.id, v === true)}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className={rowPad}>
                        <TypeIcon task={task} />
                      </TableCell>
                      <TableCell className={`max-w-72 ${rowPad}`}>
                        <span className="block truncate font-medium">{task.title}</span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {TASK_TYPE_LABELS[task.type]}
                        </span>
                      </TableCell>
                      <TableCell className={`max-w-56 ${rowPad}`}>
                        <span className="block truncate">{task.contact?.name ?? "—"}</span>
                        {task.company ? (
                          <span className="block truncate text-muted-foreground text-xs">{task.company.name}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className={`tabular-nums ${rowPad}`}>
                        <Due task={task} />
                      </TableCell>
                      <TableCell className={rowPad}>
                        <PriorityPill priority={task.priority} />
                      </TableCell>
                      <TableCell className={`max-w-40 truncate ${rowPad}`}>
                        {task.assignee?.id === currentUserId ? "You" : (task.assignee?.name ?? "Unassigned")}
                      </TableCell>
                      <TableCell className={rowPad}>
                        <TaskStatusPill status={task.status} overdue={task.overdue} />
                      </TableCell>
                      <TableCell className={`pr-4 ${rowPad}`}>
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
      <CallSession open={session} onOpenChange={setSession} scope={scope} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this task?"
        description={`"${toDelete?.title ?? ""}" will be removed for everyone. This can't be undone.`}
        confirmLabel="Delete task"
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
        onConfirm={remove}
      />
    </div>
  );
}
