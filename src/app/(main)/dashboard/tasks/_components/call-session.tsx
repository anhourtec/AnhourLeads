"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Building2, CircleCheck, Mail, Phone, PhoneCall, SkipForward, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { CALL_OUTCOME_LABELS, CALL_OUTCOMES, type CallOutcome } from "@/lib/engage-constants";
import { formatDateTime } from "@/lib/format-display";
import type { TaskDto } from "@/server/services/tasks";

import { PriorityPill } from "../../_components/pipeline/pills";

type Phase = "loading" | "error" | "ready" | "done";

/**
 * A focused queue of open call tasks, one at a time. There is no dialer: the person calls from their
 * own phone, records the outcome and moves on. Each completion logs the call on the contact.
 */
export function CallSession({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "mine" | "team";
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [queue, setQueue] = useState<TaskDto[]>([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ logged: 0, skipped: 0 });
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  async function load() {
    setPhase("loading");
    const res = await apiFetch<{ tasks: TaskDto[] }>("/api/v1/tasks/search", {
      body: { tab: "call", status: ["open"], mine: scope === "mine", sort: "due_at", per_page: 100 },
    });
    if (!res.ok) {
      setError(res.error);
      setPhase("error");
      return;
    }
    setQueue(res.data.tasks);
    setIndex(0);
    setStats({ logged: 0, skipped: 0 });
    setPhase(res.data.tasks.length ? "ready" : "done");
  }

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setOutcome("connected");
      setNote("");
      void load();
    }
  }

  const current = queue[index];

  function next() {
    setOutcome("connected");
    setNote("");
    setError(null);
    if (index + 1 >= queue.length) setPhase("done");
    else setIndex((i) => i + 1);
  }

  async function complete() {
    if (!current) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/v1/tasks/${current.id}/log_call`, {
      body: { outcome, note: note.trim() || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStats((s) => ({ ...s, logged: s.logged + 1 }));
    toast.success("Call logged");
    next();
  }

  async function skip() {
    if (!current) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/v1/tasks/${current.id}/skip`, { body: {} });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    next();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) router.refresh();
      }}
    >
      <DialogContent className="flex max-h-[95dvh] w-full flex-col overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Call session</DialogTitle>
          <DialogDescription>
            Work through your open call tasks one at a time. Call from your phone, then record how it went.
          </DialogDescription>
        </DialogHeader>
        {phase === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
            <Spinner aria-hidden="true" />
            Loading call tasks…
          </div>
        ) : null}
        {phase === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {phase === "done" ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheck aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{queue.length ? "Session complete" : "No call tasks to work on"}</EmptyTitle>
              <EmptyDescription>
                {queue.length
                  ? `${stats.logged} call${stats.logged === 1 ? "" : "s"} logged, ${stats.skipped} skipped.`
                  : "Open call tasks assigned to you appear here. Sequences with call steps create them."}
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </Empty>
        ) : null}
        {phase === "ready" && current ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span className="tabular-nums" data-testid="call-progress">
                  {index + 1} of {queue.length}
                </span>
                <span className="tabular-nums">
                  {stats.logged} logged · {stats.skipped} skipped
                </span>
              </div>
              <Progress value={(index / queue.length) * 100} aria-label="Session progress" />
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card className="gap-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="break-words">
                      {current.contact?.name ?? current.company?.name ?? "No contact"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  {current.contact?.title ? (
                    <span className="text-muted-foreground">{current.contact.title}</span>
                  ) : null}
                  {current.company ? (
                    <span className="flex items-center gap-2">
                      <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                      {current.company.name}
                    </span>
                  ) : null}
                  {current.contact?.phone ? (
                    <a
                      href={`tel:${current.contact.phone}`}
                      className="flex items-center gap-2 font-mono underline-offset-4 hover:underline"
                    >
                      <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                      {current.contact.phone}
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="size-4" aria-hidden="true" />
                      No phone number on record
                    </span>
                  )}
                  {current.contact?.email ? (
                    <a
                      href={`mailto:${current.contact.email}`}
                      className="flex min-w-0 items-center gap-2 font-mono underline-offset-4 hover:underline"
                    >
                      <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{current.contact.email}</span>
                    </a>
                  ) : null}
                  {current.contact?.linkedinUrl ? (
                    <a
                      href={current.contact.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-primary underline-offset-4 hover:underline"
                    >
                      LinkedIn profile
                    </a>
                  ) : null}
                </CardContent>
              </Card>
              <Card className="gap-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PhoneCall className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="break-words">{current.title}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                    <PriorityPill priority={current.priority} />
                    <span>Due {formatDateTime(current.dueAt)}</span>
                  </div>
                  {current.note ? <p className="whitespace-pre-line break-words">{current.note}</p> : null}
                </CardContent>
              </Card>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="call-outcome">Outcome</FieldLabel>
                <NativeSelect
                  id="call-outcome"
                  className="w-full sm:w-64"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as CallOutcome)}
                >
                  {CALL_OUTCOMES.map((o) => (
                    <NativeSelectOption key={o} value={o}>
                      {CALL_OUTCOME_LABELS[o]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="call-notes">Notes</FieldLabel>
                <Textarea
                  id="call-notes"
                  rows={3}
                  maxLength={5000}
                  value={note}
                  placeholder="What did you talk about? Any next step?"
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void skip()}>
                <SkipForward data-icon="inline-start" aria-hidden="true" />
                Skip
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void complete()}>
                <CircleCheck data-icon="inline-start" aria-hidden="true" />
                {busy ? "Saving…" : "Complete & next"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
