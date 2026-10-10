import Link from "next/link";

import { ArrowRight, CheckSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { relativeTime } from "@/lib/format-display";
import { TASK_TYPE_LABELS } from "@/lib/pipeline-constants";
import type { TaskDto } from "@/server/services/tasks";

import { PriorityPill, TaskStatusPill } from "../../_components/pipeline/pills";

export function MyTasksCard({
  tasks,
  dueToday,
  overdue,
  now,
  className,
}: {
  readonly tasks: TaskDto[];
  readonly dueToday: number;
  readonly overdue: number;
  readonly now: string;
  readonly className?: string;
}) {
  const reference = new Date(now);
  const startOfToday = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>My tasks due</CardTitle>
        <CardDescription>
          <span className="font-mono tabular-nums">{dueToday}</span> due today
          {overdue ? (
            <>
              , <span className="font-mono tabular-nums">{overdue}</span> overdue
            </>
          ) : null}
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/tasks">
              <ArrowRight data-icon="inline-start" />
              Tasks
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <Empty className="h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckSquare aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>You're all caught up</EmptyTitle>
              <EmptyDescription>Nothing assigned to you is due today.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y">
            {tasks.map((task) => {
              const isOverdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < startOfToday);
              return (
                <li key={task.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium text-sm">{task.title}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {TASK_TYPE_LABELS[task.type]}
                      {task.contact ? ` · ${task.contact.name}` : ""}
                      {task.dueAt ? ` · ${relativeTime(task.dueAt, reference)}` : " · no due date"}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <PriorityPill priority={task.priority} />
                    {isOverdue ? <TaskStatusPill status="open" overdue /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
