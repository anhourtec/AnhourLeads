"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { CheckSquare } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  type TaskPriority,
  type TaskType,
} from "@/lib/pipeline-constants";

import { apiRequest } from "../../../_components/records/api-client";

/** Create a task linked to this person (and their company). */
export function TaskDialog({
  open,
  onOpenChange,
  contactId,
  companyId,
  personName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  companyId: string | null;
  personName: string;
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("action_item");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(`Follow up with ${personName}`);
      setType("action_item");
      setPriority("medium");
      setDue("");
      setNote("");
      setError(null);
    }
  }, [open, personName]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await apiRequest("/api/v1/tasks", {
      body: {
        title,
        type,
        priority,
        contactId,
        companyId,
        note: note.trim() || undefined,
        dueAt: due ? new Date(`${due}T09:00:00`).toISOString() : undefined,
      },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("Task created.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
            <DialogDescription>The task is assigned to you and linked to {personName}.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={200}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-type`}>Type</Label>
              <NativeSelect id={`${id}-type`} value={type} onChange={(e) => setType(e.target.value as TaskType)}>
                {TASK_TYPES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TASK_TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-priority`}>Priority</Label>
              <NativeSelect
                id={`${id}-priority`}
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {TASK_PRIORITIES.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {TASK_PRIORITY_LABELS[p]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-due`}>Due date</Label>
            <Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-note`}>Description</Label>
            <Textarea
              id={`${id}-note`}
              value={note}
              maxLength={5000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !title.trim()}>
              <CheckSquare data-icon="inline-start" aria-hidden="true" />
              {pending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
