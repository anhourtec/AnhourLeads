"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { toDateInput } from "@/lib/format-display";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  type TaskPriority,
  type TaskType,
} from "@/lib/pipeline-constants";
import type { TaskDto } from "@/server/services/tasks";

import type { MemberOption } from "./types";

export function TaskDialog({
  open,
  onOpenChange,
  task,
  members,
  defaultAssigneeId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly task: TaskDto | null;
  readonly members: MemberOption[];
  readonly defaultAssigneeId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const editing = Boolean(task);
  const closed = task !== null && task.status !== "open";
  let submitLabel = editing ? "Save task" : "Create task";
  if (pending) submitLabel = "Saving…";

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    setFields({});
    const due = String(form.get("dueAt") ?? "");
    const body = {
      title: String(form.get("title") ?? "").trim(),
      type: String(form.get("type")) as TaskType,
      priority: String(form.get("priority")) as TaskPriority,
      assigneeId: String(form.get("assigneeId")),
      dueAt: due ? due : null,
      note: String(form.get("note") ?? "").trim() || null,
    };
    const payload = closed ? { priority: body.priority, note: body.note } : body;
    const res = await apiFetch<{ task: TaskDto }>(task ? `/api/v1/tasks/${task.id}` : "/api/v1/tasks", {
      method: task ? "PATCH" : "POST",
      body: payload,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setFields(res.fields);
      return;
    }
    toast.success(task ? "Task saved" : "Task created");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {closed ? "This task is closed. You can still change its priority and note." : "Plan the next touch."}
          </DialogDescription>
        </DialogHeader>
        <form
          key={task?.id ?? "new"}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(new FormData(event.currentTarget));
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(fields.title)}>
              <FieldLabel htmlFor="task-title">Title</FieldLabel>
              <Input
                id="task-title"
                name="title"
                required
                maxLength={200}
                defaultValue={task?.title ?? ""}
                disabled={closed}
                aria-invalid={Boolean(fields.title)}
                placeholder="Call about the pilot"
              />
              {fields.title ? <FieldError>{fields.title}</FieldError> : null}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="task-type">Type</FieldLabel>
                <NativeSelect
                  id="task-type"
                  name="type"
                  defaultValue={task?.type ?? "call"}
                  disabled={closed}
                  className="w-full"
                >
                  {TASK_TYPES.map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {TASK_TYPE_LABELS[t]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
                <NativeSelect
                  id="task-priority"
                  name="priority"
                  defaultValue={task?.priority ?? "medium"}
                  className="w-full"
                >
                  {TASK_PRIORITIES.map((p) => (
                    <NativeSelectOption key={p} value={p}>
                      {TASK_PRIORITY_LABELS[p]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(fields.assigneeId)}>
                <FieldLabel htmlFor="task-assignee">Assignee</FieldLabel>
                <NativeSelect
                  id="task-assignee"
                  name="assigneeId"
                  defaultValue={task?.assignee?.id ?? defaultAssigneeId}
                  disabled={closed}
                  className="w-full"
                >
                  {members.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fields.assigneeId ? <FieldError>{fields.assigneeId}</FieldError> : null}
              </Field>
              <Field data-invalid={Boolean(fields.dueAt)}>
                <FieldLabel htmlFor="task-due">Due date</FieldLabel>
                <Input
                  id="task-due"
                  name="dueAt"
                  type="date"
                  defaultValue={toDateInput(task?.dueAt)}
                  disabled={closed}
                />
                {fields.dueAt ? <FieldError>{fields.dueAt}</FieldError> : null}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="task-note">Note</FieldLabel>
              <Textarea id="task-note" name="note" maxLength={5000} defaultValue={task?.note ?? ""} rows={3} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {editing ? <Save data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
