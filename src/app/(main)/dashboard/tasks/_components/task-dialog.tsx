"use client";

import { useRef, useState } from "react";

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
import { formatClock } from "@/lib/engage-constants";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  type TaskPriority,
  type TaskType,
} from "@/lib/pipeline-constants";
import type { TaskDto } from "@/server/services/tasks";

import { type Association, AssociationPicker } from "../../_components/engage/association-picker";
import { insertAtCursor, SnippetPicker } from "../../_components/engage/insert-pickers";
import type { MemberOption } from "./types";

/** Types offered when creating a task, in the order of the reference (generic "LinkedIn" is legacy). */
const FORM_TYPES: TaskType[] = [
  "call",
  "email",
  "action_item",
  "linkedin_connect",
  "linkedin_message",
  "linkedin_view",
  "linkedin_interact",
];

/** 30-minute slots, 00:00 to 23:30. */
export const TIME_SLOTS = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

const pad = (n: number) => String(n).padStart(2, "0");

/** Local date (YYYY-MM-DD) and the nearest later 30-minute slot for an ISO time, or now. */
function splitDue(iso: string | null | undefined): { date: string; time: string } {
  const d = iso ? new Date(iso) : new Date(Date.now() + 30 * 60_000);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const slot = Math.min(47, Math.ceil(minutes / 30));
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: TIME_SLOTS[slot] ?? "09:00",
  };
}

function associationOf(task: TaskDto | null): Association | null {
  if (!task) return null;
  if (task.contact) {
    return {
      kind: "contact",
      id: task.contact.id,
      name: task.contact.name,
      detail: task.contact.email,
      companyId: task.company?.id ?? null,
    };
  }
  if (task.company) {
    return { kind: "company", id: task.company.id, name: task.company.name, detail: null, companyId: task.company.id };
  }
  return null;
}

/** New / edit task, laid out like the reference: associated with, type, title, description, due, priority, assignee. */
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
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [association, setAssociation] = useState<Association | null>(null);
  const [type, setType] = useState<TaskType>("call");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("09:00");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = `${open}-${task?.id ?? "new"}`;
  if (key !== lastKey) {
    setLastKey(key);
    const due = splitDue(task?.dueAt);
    setAssociation(associationOf(task));
    setType(task?.type ?? "call");
    setTitle(task?.title ?? "");
    setNote(task?.note ?? "");
    setDueDate(task && !task.dueAt ? "" : due.date);
    setDueTime(due.time);
    setPriority(task?.priority ?? "medium");
    setAssigneeId(task?.assignee?.id ?? defaultAssigneeId);
    setError(null);
    setFields({});
  }

  const associationError = fields.association || fields.contactId || fields.companyId || null;
  const editing = Boolean(task);
  const closed = task !== null && task.status !== "open";
  let submitLabel = editing ? "Save task" : "Create task";
  if (pending) submitLabel = "Saving…";

  async function submit() {
    const missing: Record<string, string> = {};
    if (!editing && !association) missing.association = "Choose a contact or company.";
    if (!title.trim()) missing.title = "Give the task a title.";
    if (Object.keys(missing).length) {
      setFields(missing);
      setError(null);
      return;
    }
    setPending(true);
    setError(null);
    setFields({});
    const dueAt = dueDate ? new Date(`${dueDate}T${dueTime}:00`).toISOString() : null;
    const body: Record<string, unknown> = closed
      ? { priority, note: note.trim() || null }
      : {
          title: title.trim(),
          type,
          priority,
          assigneeId,
          dueAt,
          note: note.trim() || null,
          contactId: association?.kind === "contact" ? association.id : null,
          companyId: association?.kind === "company" ? association.id : (association?.companyId ?? null),
        };
    const res = await apiFetch<{ task: TaskDto }>(task ? `/api/v1/tasks/${task.id}` : "/api/v1/tasks", {
      method: task ? "PATCH" : "POST",
      body,
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription className={closed ? undefined : "sr-only"}>
            {closed
              ? "This task is closed. You can still change its priority and description."
              : "Plan the next touch."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(associationError)}>
              <FieldLabel htmlFor="task-association">
                Associated with <span aria-hidden="true">*</span>
              </FieldLabel>
              <AssociationPicker
                id="task-association"
                value={association}
                onChange={setAssociation}
                disabled={closed}
                invalid={Boolean(associationError)}
              />
              {associationError ? <FieldError>{associationError}</FieldError> : null}
            </Field>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Field>
                <FieldLabel htmlFor="task-type">Type</FieldLabel>
                <NativeSelect
                  id="task-type"
                  value={type}
                  disabled={closed}
                  className="w-full"
                  onChange={(e) => setType(e.target.value as TaskType)}
                >
                  {(FORM_TYPES.includes(type) ? FORM_TYPES : [type, ...FORM_TYPES]).map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {TASK_TYPE_LABELS[t]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={Boolean(fields.title)}>
                <FieldLabel htmlFor="task-title">
                  Title <span aria-hidden="true">*</span>
                </FieldLabel>
                <Input
                  id="task-title"
                  required
                  maxLength={200}
                  value={title}
                  disabled={closed}
                  aria-invalid={Boolean(fields.title)}
                  placeholder="Enter title"
                  onChange={(e) => setTitle(e.target.value)}
                />
                {fields.title ? <FieldError>{fields.title}</FieldError> : null}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="task-note">Description</FieldLabel>
              <Textarea
                id="task-note"
                ref={noteRef}
                maxLength={5000}
                rows={3}
                value={note}
                placeholder="Add description"
                onChange={(e) => setNote(e.target.value)}
              />
              <div>
                <SnippetPicker
                  onPick={(body) => {
                    const next = insertAtCursor(noteRef.current, note, body);
                    setNote(next.value);
                  }}
                />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={Boolean(fields.dueAt)}>
                <FieldLabel htmlFor="task-due">Due date</FieldLabel>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  disabled={closed}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {fields.dueAt ? <FieldError>{fields.dueAt}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="task-time">Due time</FieldLabel>
                <NativeSelect
                  id="task-time"
                  value={dueTime}
                  disabled={closed || !dueDate}
                  className="w-full"
                  onChange={(e) => setDueTime(e.target.value)}
                >
                  {TIME_SLOTS.map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {formatClock(t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
                <NativeSelect
                  id="task-priority"
                  value={priority}
                  className="w-full"
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <NativeSelectOption key={p} value={p}>
                      {TASK_PRIORITY_LABELS[p]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={Boolean(fields.assigneeId)}>
                <FieldLabel htmlFor="task-assignee">Assignee</FieldLabel>
                <NativeSelect
                  id="task-assignee"
                  value={assigneeId}
                  disabled={closed}
                  className="w-full"
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  {members.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.id === defaultAssigneeId ? `${m.name} (you)` : m.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fields.assigneeId ? <FieldError>{fields.assigneeId}</FieldError> : null}
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {editing ? (
                <Save data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
