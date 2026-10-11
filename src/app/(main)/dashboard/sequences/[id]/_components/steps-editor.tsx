"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowDown, ArrowUp, Mail, Phone, Plus, Save, SquareCheck, Trash2, Undo2, UserPen } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { DetailedStats, StepView } from "@/server/services/sequences";

import { apiRequest } from "../../../_components/records/api-client";

type StepType = StepView["type"];

interface Draft {
  key: string;
  id?: string;
  type: StepType;
  waitDays: string;
  subject: string;
  body: string;
}

const TYPE_LABELS: Record<StepType, string> = {
  auto_email: "Automatic email",
  manual_email: "Manual email",
  call: "Phone call",
  task: "Action item",
  linkedin_connect: "LinkedIn: send connection request",
  linkedin_message: "LinkedIn: send message",
  linkedin_view: "LinkedIn: view profile",
  linkedin_interact: "LinkedIn: interact with post",
};

const TYPE_ICONS: Record<StepType, typeof Mail> = {
  auto_email: Mail,
  manual_email: UserPen,
  call: Phone,
  task: SquareCheck,
  linkedin_connect: SquareCheck,
  linkedin_message: SquareCheck,
  linkedin_view: SquareCheck,
  linkedin_interact: SquareCheck,
};

const MERGE_FIELDS = [
  ["{{first_name}}", "First name"],
  ["{{last_name}}", "Last name"],
  ["{{company}}", "Company name"],
  ["{{title}}", "Job title"],
] as const;

let counter = 0;
const newKey = () => `new-${++counter}`;

function toDrafts(steps: StepView[]): Draft[] {
  return steps.map((s) => ({
    key: s.id,
    id: s.id,
    type: s.type,
    waitDays: String(s.waitDays),
    subject: s.subject ?? "",
    body: s.body ?? "",
  }));
}

function serialise(drafts: Draft[]) {
  return drafts.map((d) => ({
    ...(d.id ? { id: d.id } : {}),
    type: d.type,
    waitDays: Number.parseInt(d.waitDays, 10) || 0,
    subject: d.type === "auto_email" || d.type === "manual_email" ? d.subject : null,
    body: d.body,
  }));
}

function MergeFieldHelp() {
  return (
    <aside className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm" aria-label="Merge fields">
      <p className="font-medium">Merge fields</p>
      <p className="text-muted-foreground text-xs">
        Use these in subjects and bodies. If a contact is missing a value, the message is held back instead of being
        sent with a gap.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {MERGE_FIELDS.map(([token, label]) => (
          <div key={token} className="contents">
            <dt className="font-mono text-xs">{token}</dt>
            <dd className="text-muted-foreground text-xs">{label}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs">
        Every email gets a footer with your sender name, the mailbox's postal address and a one-click unsubscribe link.
      </p>
    </aside>
  );
}

export function StepsEditor({
  sequenceId,
  steps,
  stepStats,
  canEdit,
}: {
  sequenceId: string;
  steps: StepView[];
  stepStats: DetailedStats["steps"];
  canEdit: boolean;
}) {
  const router = useRouter();
  const original = useMemo(() => toDrafts(steps), [steps]);
  const [drafts, setDrafts] = useState<Draft[]>(original);
  const [newType, setNewType] = useState<StepType>("auto_email");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(serialise(drafts)) !== JSON.stringify(serialise(original));
  const sentBy = new Map(stepStats.map((s) => [s.stepId, s]));

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    const result = await apiRequest<{ emailer_steps: StepView[] }>(`/api/v1/emailer_campaigns/${sequenceId}/steps`, {
      method: "PUT",
      body: { steps: serialise(drafts) },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDrafts(toDrafts(result.data.emailer_steps));
    toast.success("Steps saved.");
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {drafts.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Mail aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No steps yet</EmptyTitle>
              <EmptyDescription>
                {canEdit ? "Add an email, call or task to start." : "Steps added to this sequence appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ol className="flex flex-col gap-3">
          {drafts.map((d, index) => {
            const Icon = TYPE_ICONS[d.type];
            const isEmail = d.type === "auto_email" || d.type === "manual_email";
            const stat = d.id ? sentBy.get(d.id) : undefined;
            const idp = `step-${d.key}`;
            return (
              <li key={d.key}>
                <Card className="min-w-0 gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">
                        Step {index + 1} · {TYPE_LABELS[d.type]}
                      </span>
                    </CardTitle>
                    {canEdit ? (
                      <CardAction className="flex items-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Move step ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Move step ${index + 1} down`}
                          disabled={index === drafts.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove step ${index + 1}`}
                          onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </CardAction>
                    ) : null}
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 px-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor={`${idp}-type`} className="text-xs">
                          Type
                        </FieldLabel>
                        <NativeSelect
                          id={`${idp}-type`}
                          size="sm"
                          className="w-full"
                          value={d.type}
                          disabled={!canEdit}
                          onChange={(e) => update(d.key, { type: e.target.value as StepType })}
                        >
                          {(Object.keys(TYPE_LABELS) as StepType[]).map((t) => (
                            <NativeSelectOption key={t} value={t}>
                              {TYPE_LABELS[t]}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor={`${idp}-wait`} className="text-xs">
                          {index === 0 ? "Days after enrolling" : "Days after the previous step"}
                        </FieldLabel>
                        <Input
                          id={`${idp}-wait`}
                          type="number"
                          min={0}
                          max={365}
                          inputMode="numeric"
                          className="h-7 font-mono"
                          value={d.waitDays}
                          disabled={!canEdit}
                          onChange={(e) => update(d.key, { waitDays: e.target.value })}
                        />
                      </Field>
                    </div>
                    {isEmail ? (
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor={`${idp}-subject`} className="text-xs">
                          Subject
                        </FieldLabel>
                        <Input
                          id={`${idp}-subject`}
                          value={d.subject}
                          maxLength={300}
                          disabled={!canEdit}
                          onChange={(e) => update(d.key, { subject: e.target.value })}
                        />
                      </Field>
                    ) : null}
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor={`${idp}-body`} className="text-xs">
                        {isEmail ? "Body" : "Notes for the task"}
                      </FieldLabel>
                      <Textarea
                        id={`${idp}-body`}
                        rows={isEmail ? 6 : 3}
                        value={d.body}
                        disabled={!canEdit}
                        onChange={(e) => update(d.key, { body: e.target.value })}
                      />
                    </Field>
                    {stat ? (
                      <p className="text-muted-foreground text-xs">
                        <span className="font-mono tabular-nums">{stat.sent}</span> sent ·{" "}
                        <span className="font-mono tabular-nums">{stat.pendingReview}</span> waiting for review
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
        {canEdit ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <NativeSelect
                size="sm"
                aria-label="New step type"
                className="w-40"
                value={newType}
                onChange={(e) => setNewType(e.target.value as StepType)}
              >
                {(Object.keys(TYPE_LABELS) as StepType[]).map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                disabled={drafts.length >= 30}
                onClick={() =>
                  setDrafts((list) => [
                    ...list,
                    { key: newKey(), type: newType, waitDays: list.length ? "3" : "0", subject: "", body: "" },
                  ])
                }
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add step
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {dirty ? (
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDrafts(original)}>
                  <Undo2 data-icon="inline-start" aria-hidden="true" />
                  Discard
                </Button>
              ) : null}
              <Button size="sm" disabled={!dirty || saving} onClick={save}>
                <Save data-icon="inline-start" aria-hidden="true" />
                {saving ? "Saving…" : "Save steps"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <MergeFieldHelp />
    </div>
  );
}
