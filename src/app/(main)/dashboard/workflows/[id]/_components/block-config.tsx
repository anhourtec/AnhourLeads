"use client";

import type { ReactNode } from "react";

import { Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_TYPE_LABELS, TASK_TYPES } from "@/lib/pipeline-constants";
import { BLOCK_INFO, type WorkflowBlock, type WorkflowCondition, type WorkflowTarget } from "@/lib/workflows";

import { ConditionsEditor } from "./conditions-editor";
import type { PickerData } from "./types";

type Config = Record<string, unknown>;

function Select({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full"
      >
        {children}
      </NativeSelect>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

function Text({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = "text",
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function Form({
  block,
  target,
  data,
  disabled,
  set,
}: {
  block: WorkflowBlock;
  target: WorkflowTarget;
  data: PickerData;
  disabled: boolean;
  set: (patch: Config) => void;
}) {
  const c = block.config;
  const id = (name: string) => `cfg-${block.id}-${name}`;
  const listEntity = target === "company" ? "company" : "contact";
  switch (block.type) {
    case "branch_if":
      return (
        <ConditionsEditor
          idPrefix={block.id}
          target={target}
          data={data}
          disabled={disabled}
          match={(c.match as "all" | "any" | undefined) ?? "all"}
          conditions={(c.conditions as WorkflowCondition[] | undefined) ?? []}
          onChange={(next) => set(next)}
        />
      );
    case "split_multi": {
      const cases =
        (c.cases as
          | { key: string; label?: string; match: "all" | "any"; conditions: WorkflowCondition[] }[]
          | undefined) ?? [];
      const update = (next: typeof cases) => set({ cases: next });
      return (
        <div className="flex flex-col gap-4">
          {cases.map((cs, i) => (
            <div key={cs.key} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Path ${i + 1} name`}
                  value={cs.label ?? ""}
                  disabled={disabled}
                  onChange={(e) => update(cases.map((x) => (x.key === cs.key ? { ...x, label: e.target.value } : x)))}
                  className="h-8"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove path ${i + 1}`}
                  disabled={disabled || cases.length <= 1}
                  onClick={() => update(cases.filter((x) => x.key !== cs.key))}
                >
                  <Trash2 />
                </Button>
              </div>
              <ConditionsEditor
                idPrefix={`${block.id}-${cs.key}`}
                target={target}
                data={data}
                disabled={disabled}
                match={cs.match}
                conditions={cs.conditions}
                onChange={(next) => update(cases.map((x) => (x.key === cs.key ? { ...x, ...next } : x)))}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={disabled || cases.length >= 5}
            onClick={() => {
              const used = new Set(cases.map((x) => x.key));
              let n = cases.length + 1;
              while (used.has(`c${n}`)) n += 1;
              update([...cases, { key: `c${n}`, label: `Path ${cases.length + 1}`, match: "all", conditions: [] }]);
            }}
          >
            <Plus data-icon="inline-start" />
            Add path
          </Button>
          <p className="text-muted-foreground text-xs">Records that match no path go down “Everyone else”.</p>
        </div>
      );
    }
    case "split_traffic": {
      const splits = (c.splits as { key: string; percent: number; label?: string }[] | undefined) ?? [];
      const total = splits.reduce((n, s) => n + (Number(s.percent) || 0), 0);
      return (
        <div className="flex flex-col gap-3">
          {splits.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="w-16 text-sm">Path {String.fromCharCode(65 + i)}</span>
              <Input
                aria-label={`Path ${String.fromCharCode(65 + i)} percent`}
                inputMode="numeric"
                value={String(s.percent)}
                disabled={disabled}
                onChange={(e) =>
                  set({
                    splits: splits.map((x) =>
                      x.key === s.key
                        ? { ...x, percent: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) }
                        : x,
                    ),
                  })
                }
                className="h-8 w-20 font-mono"
              />
              <span className="text-muted-foreground text-sm">%</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove path ${String.fromCharCode(65 + i)}`}
                disabled={disabled || splits.length <= 2}
                onClick={() => set({ splits: splits.filter((x) => x.key !== s.key) })}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={disabled || splits.length >= 5}
            onClick={() => {
              const used = new Set(splits.map((x) => x.key));
              const key = "abcde".split("").find((k) => !used.has(k)) ?? `p${splits.length}`;
              set({ splits: [...splits, { key, percent: 0 }] });
            }}
          >
            <Plus data-icon="inline-start" />
            Add path
          </Button>
          <p className={total === 100 ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>
            Total {total}% {total === 100 ? "" : "(must be 100%)"}
          </p>
        </div>
      );
    }
    case "delay":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Text
            id={id("amount")}
            label="Wait"
            value={str(c.amount)}
            disabled={disabled}
            onChange={(v) => set({ amount: Math.max(1, Number(v.replace(/\D/g, "")) || 1) })}
          />
          <Select
            id={id("unit")}
            label="Unit"
            value={str(c.unit) || "days"}
            disabled={disabled}
            onChange={(v) => set({ unit: v })}
          >
            <NativeSelectOption value="minutes">Minutes</NativeSelectOption>
            <NativeSelectOption value="hours">Hours</NativeSelectOption>
            <NativeSelectOption value="days">Days</NativeSelectOption>
          </Select>
        </div>
      );
    case "exit":
      return <p className="text-muted-foreground text-sm">The record leaves the workflow here.</p>;
    case "add_to_list":
    case "remove_from_list":
      return (
        <Select
          id={id("list")}
          label="List"
          value={str(c.listId)}
          disabled={disabled}
          onChange={(v) => set({ listId: v || undefined })}
          hint="Static lists only; dynamic lists update from their filters."
        >
          <NativeSelectOption value="">Choose a list</NativeSelectOption>
          {data.lists
            .filter(
              (l) =>
                l.kind === "static" &&
                (block.type === "remove_from_list" || l.entityType === listEntity || target === "deal"),
            )
            .map((l) => (
              <NativeSelectOption key={l.id} value={l.id}>
                {l.name} ({l.entityType === "contact" ? "people" : "companies"})
              </NativeSelectOption>
            ))}
        </Select>
      );
    case "add_to_sequence":
      return (
        <Select
          id={id("sequence")}
          label="Sequence"
          value={str(c.sequenceId)}
          disabled={disabled}
          onChange={(v) => set({ sequenceId: v || undefined })}
          hint="People on the do-not-contact list are never enrolled."
        >
          <NativeSelectOption value="">Choose a sequence</NativeSelectOption>
          {data.sequences.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name}
            </NativeSelectOption>
          ))}
        </Select>
      );
    case "remove_from_sequence":
      return (
        <Select
          id={id("sequence")}
          label="Sequence"
          value={str(c.sequenceId) || "all"}
          disabled={disabled}
          onChange={(v) => set({ sequenceId: v })}
        >
          <NativeSelectOption value="all">All sequences</NativeSelectOption>
          {data.sequences.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name}
            </NativeSelectOption>
          ))}
        </Select>
      );
    case "create_task":
      return (
        <div className="flex flex-col gap-3">
          <Text
            id={id("title")}
            label="Task title"
            value={str(c.title)}
            disabled={disabled}
            onChange={(v) => set({ title: v })}
            placeholder="Call to follow up"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              id={id("type")}
              label="Type"
              value={str(c.taskType) || "action_item"}
              disabled={disabled}
              onChange={(v) => set({ taskType: v })}
            >
              {TASK_TYPES.filter((t) => t !== "linkedin" && t !== "email").map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </NativeSelectOption>
              ))}
            </Select>
            <Select
              id={id("priority")}
              label="Priority"
              value={str(c.priority) || "medium"}
              disabled={disabled}
              onChange={(v) => set({ priority: v })}
            >
              {TASK_PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </NativeSelectOption>
              ))}
            </Select>
            <Text
              id={id("due")}
              label="Due in (days)"
              value={str(c.dueInDays)}
              disabled={disabled}
              onChange={(v) => set({ dueInDays: Math.min(365, Number(v.replace(/\D/g, "")) || 0) })}
            />
            <Select
              id={id("assignee")}
              label="Assign to"
              value={str(c.assignee) || "owner"}
              disabled={disabled}
              onChange={(v) => set({ assignee: v })}
            >
              <NativeSelectOption value="owner">The record's owner</NativeSelectOption>
              <NativeSelectOption value="creator">The workflow owner</NativeSelectOption>
              {data.members.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.name}
                </NativeSelectOption>
              ))}
            </Select>
          </div>
        </div>
      );
    case "update_record": {
      const field = str(c.field) || "stage";
      const stages = target === "company" ? data.companyStages : data.contactStages;
      return (
        <div className="flex flex-col gap-3">
          <Select
            id={id("field")}
            label="Field"
            value={field}
            disabled={disabled}
            onChange={(v) => set({ field: v, value: "" })}
          >
            {target !== "deal" ? <NativeSelectOption value="stage">Stage</NativeSelectOption> : null}
            <NativeSelectOption value="owner">Owner</NativeSelectOption>
            <NativeSelectOption value="customField">Custom field</NativeSelectOption>
          </Select>
          {field === "stage" ? (
            <Select
              id={id("value")}
              label="New stage"
              value={str(c.value)}
              disabled={disabled}
              onChange={(v) => set({ value: v })}
            >
              <NativeSelectOption value="">Choose a stage</NativeSelectOption>
              {stages.map((s) => (
                <NativeSelectOption key={s.key} value={s.key}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </Select>
          ) : null}
          {field === "owner" ? (
            <Select
              id={id("value")}
              label="New owner"
              value={str(c.value)}
              disabled={disabled}
              onChange={(v) => set({ value: v })}
            >
              <NativeSelectOption value="">Choose someone</NativeSelectOption>
              {data.members.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.name}
                </NativeSelectOption>
              ))}
            </Select>
          ) : null}
          {field === "customField" ? (
            <div className="grid grid-cols-2 gap-3">
              <Text
                id={id("key")}
                label="Field key"
                value={str(c.customFieldKey)}
                disabled={disabled}
                onChange={(v) => set({ customFieldKey: v })}
              />
              <Text
                id={id("value")}
                label="Value"
                value={str(c.value)}
                disabled={disabled}
                onChange={(v) => set({ value: v })}
              />
            </div>
          ) : null}
        </div>
      );
    }
    case "create_deal": {
      const pipeline = data.pipelines.find((p) => p.id === c.pipelineId) ?? data.pipelines[0];
      return (
        <div className="flex flex-col gap-3">
          <Text
            id={id("name")}
            label="Deal name"
            value={str(c.name)}
            disabled={disabled}
            onChange={(v) => set({ name: v })}
            placeholder="Leave blank to use the record's name"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              id={id("pipeline")}
              label="Pipeline"
              value={str(c.pipelineId)}
              disabled={disabled}
              onChange={(v) => set({ pipelineId: v || undefined, stageId: undefined })}
            >
              <NativeSelectOption value="">Default pipeline</NativeSelectOption>
              {data.pipelines.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </Select>
            <Select
              id={id("stage")}
              label="Stage"
              value={str(c.stageId)}
              disabled={disabled}
              onChange={(v) => set({ stageId: v || undefined })}
            >
              <NativeSelectOption value="">First stage</NativeSelectOption>
              {(c.pipelineId ? (pipeline?.stages ?? []) : []).map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </Select>
            <Text
              id={id("amount")}
              label="Amount"
              value={str(c.amount)}
              disabled={disabled}
              onChange={(v) => set({ amount: v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : null })}
            />
          </div>
        </div>
      );
    }
    case "update_deal_stage":
      return (
        <Select
          id={id("stage")}
          label="Move to stage"
          value={str(c.stageId)}
          disabled={disabled}
          onChange={(v) => set({ stageId: v || undefined })}
        >
          <NativeSelectOption value="">Choose a stage</NativeSelectOption>
          {data.pipelines.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {p.stages.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </optgroup>
          ))}
        </Select>
      );
    case "enrich":
      return (
        <p className="text-muted-foreground text-sm">
          Finds and verifies the person's email, or crawls the company's public website, with your configured providers.
        </p>
      );
    case "notify":
      return (
        <div className="flex flex-col gap-3">
          <Select
            id={id("recipients")}
            label="Notify"
            value={Array.isArray(c.recipients) ? str(c.recipients[0]) : str(c.recipients) || "owner"}
            disabled={disabled}
            onChange={(v) => set({ recipients: v === "owner" || v === "creator" ? v : [v] })}
          >
            <NativeSelectOption value="owner">The record's owner</NativeSelectOption>
            <NativeSelectOption value="creator">The workflow owner</NativeSelectOption>
            {data.members.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.name}
              </NativeSelectOption>
            ))}
          </Select>
          <Field>
            <FieldLabel htmlFor={id("message")}>Message</FieldLabel>
            <Textarea
              id={id("message")}
              value={str(c.message)}
              disabled={disabled}
              maxLength={500}
              onChange={(e) => set({ message: e.target.value })}
            />
          </Field>
        </div>
      );
    case "webhook":
      return (
        <div className="flex flex-col gap-3">
          <Text
            id={id("url")}
            label="Endpoint URL"
            type="url"
            value={str(c.url)}
            disabled={disabled}
            onChange={(v) => set({ url: v })}
            placeholder="https://example.com/hooks/anhour"
            hint="We POST the record as JSON. https only; private addresses are refused."
          />
          <Text
            id={id("secret")}
            label="Signing secret"
            type="password"
            value={str(c.secret)}
            disabled={disabled}
            onChange={(v) => set({ secret: v })}
            placeholder={c.hasSecret ? "Saved. Type to replace it." : "At least 16 characters"}
            hint="Each request carries an x-anhour-signature header: sha256 HMAC of “timestamp.body”."
          />
        </div>
      );
    case "research_ai":
    case "qualify_ai":
      return (
        <div className="flex flex-col gap-3">
          <Alert>
            <AlertDescription>
              Agents need an AI provider set up by an administrator. Without one, this step is skipped and noted in the
              run log.
            </AlertDescription>
          </Alert>
          <Field>
            <FieldLabel htmlFor={id("prompt")}>
              {block.type === "research_ai" ? "What to research" : "Qualification criteria"}
            </FieldLabel>
            <Textarea
              id={id("prompt")}
              value={str(c.prompt)}
              disabled={disabled}
              maxLength={2000}
              onChange={(e) => set({ prompt: e.target.value })}
            />
          </Field>
        </div>
      );
    default:
      return null;
  }
}

/** Side panel to configure the selected block. */
export function BlockConfigSheet({
  block,
  target,
  data,
  readOnly,
  onChange,
  onDelete,
  onClose,
}: {
  readonly block: WorkflowBlock | null;
  readonly target: WorkflowTarget;
  readonly data: PickerData;
  readonly readOnly: boolean;
  readonly onChange: (config: Config) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Sheet open={block !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        {block ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{BLOCK_INFO[block.type].label}</SheetTitle>
              <SheetDescription>{BLOCK_INFO[block.type].description}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 p-4">
              <Form
                block={block}
                target={target}
                data={data}
                disabled={readOnly}
                set={(patch) => onChange({ ...block.config, ...patch })}
              />
            </div>
            <SheetFooter className="mt-auto flex-row justify-between border-t">
              {!readOnly ? (
                <Button size="sm" variant="outline" onClick={onDelete}>
                  <Trash2 data-icon="inline-start" />
                  Remove block
                </Button>
              ) : (
                <span />
              )}
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
