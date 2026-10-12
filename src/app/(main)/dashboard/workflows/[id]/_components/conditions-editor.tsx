"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EMAIL_STATUS_LABELS, EMAIL_STATUSES, SENIORITIES, SENIORITY_LABELS } from "@/lib/records-vocabulary";
import {
  CONDITION_OP_LABELS,
  type ConditionField,
  type ConditionOp,
  conditionFields,
  type WorkflowCondition,
  type WorkflowTarget,
} from "@/lib/workflows";

import type { PickerData } from "./types";

function opsFor(field: ConditionField | undefined): ConditionOp[] {
  switch (field?.kind) {
    case "list":
      return ["in_list", "not_in_list"];
    case "number":
      return ["eq", "gt", "lt", "is_empty", "is_not_empty"];
    case "text":
      return ["contains", "not_contains", "eq", "neq", "is_empty", "is_not_empty"];
    default:
      return ["eq", "neq", "is_empty", "is_not_empty"];
  }
}

function optionsFor(field: ConditionField | undefined, target: WorkflowTarget, data: PickerData) {
  if (!field) return null;
  if (field.options) return field.options;
  if (field.kind === "stage") {
    return (target === "company" ? data.companyStages : data.contactStages).map((s) => ({
      value: s.key,
      label: s.label,
    }));
  }
  if (field.kind === "member") return data.members.map((m) => ({ value: m.id, label: m.name }));
  if (field.kind === "list") {
    return data.lists
      .filter((l) => l.entityType === (target === "company" ? "company" : "contact"))
      .map((l) => ({ value: l.id, label: l.name }));
  }
  if (field.id === "emailStatus") return EMAIL_STATUSES.map((s) => ({ value: s, label: EMAIL_STATUS_LABELS[s] }));
  if (field.id === "seniority") return SENIORITIES.map((s) => ({ value: s, label: SENIORITY_LABELS[s] }));
  return null;
}

/** Conditions on a record's fields, matched all or any. */
export function ConditionsEditor({
  idPrefix,
  target,
  data,
  match,
  conditions,
  disabled,
  onChange,
}: {
  readonly idPrefix: string;
  readonly target: WorkflowTarget;
  readonly data: PickerData;
  readonly match: "all" | "any";
  readonly conditions: WorkflowCondition[];
  readonly disabled: boolean;
  readonly onChange: (next: { match: "all" | "any"; conditions: WorkflowCondition[] }) => void;
}) {
  const fields = conditionFields(target);
  const set = (i: number, patch: Partial<WorkflowCondition>) =>
    onChange({ match, conditions: conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const valueControl = (
    c: WorkflowCondition,
    i: number,
    field: ConditionField | undefined,
    options: { value: string; label: string }[] | null,
    needsValue: boolean,
  ) => {
    if (!needsValue) return <span />;
    if (options) {
      return (
        <NativeSelect
          size="sm"
          aria-label={`Condition ${i + 1} value`}
          value={String(c.value ?? "")}
          disabled={disabled}
          onChange={(e) => set(i, { value: e.target.value })}
          className="w-full"
        >
          <NativeSelectOption value="">Choose…</NativeSelectOption>
          {options.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    }
    return (
      <Input
        aria-label={`Condition ${i + 1} value`}
        value={String(c.value ?? "")}
        disabled={disabled}
        inputMode={field?.kind === "number" ? "numeric" : undefined}
        onChange={(e) =>
          set(i, {
            value: field?.kind === "number" && e.target.value !== "" ? Number(e.target.value) || 0 : e.target.value,
          })
        }
        className="h-8"
      />
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span>Match</span>
        <NativeSelect
          size="sm"
          aria-label="Match all or any"
          value={match}
          disabled={disabled}
          onChange={(e) => onChange({ match: e.target.value === "any" ? "any" : "all", conditions })}
        >
          <NativeSelectOption value="all">all conditions</NativeSelectOption>
          <NativeSelectOption value="any">any condition</NativeSelectOption>
        </NativeSelect>
      </div>
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.id === c.field);
        const options = optionsFor(field, target, data);
        const needsValue = c.op !== "is_empty" && c.op !== "is_not_empty";
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: conditions are an ordered draft without ids
            key={`${idPrefix}-${i}`}
            className="grid grid-cols-1 gap-1.5 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <NativeSelect
              size="sm"
              aria-label={`Condition ${i + 1} field`}
              value={c.field}
              disabled={disabled}
              onChange={(e) => {
                const next = fields.find((f) => f.id === e.target.value);
                set(i, { field: e.target.value, op: opsFor(next)[0], value: "" });
              }}
              className="w-full"
            >
              {fields.map((f) => (
                <NativeSelectOption key={f.id} value={f.id}>
                  {f.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              size="sm"
              aria-label={`Condition ${i + 1} operator`}
              value={c.op}
              disabled={disabled}
              onChange={(e) => set(i, { op: e.target.value as ConditionOp })}
              className="w-full"
            >
              {opsFor(field).map((op) => (
                <NativeSelectOption key={op} value={op}>
                  {CONDITION_OP_LABELS[op]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {valueControl(c, i, field, options, needsValue)}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove condition ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange({ match, conditions: conditions.filter((_, j) => j !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={disabled || conditions.length >= 10}
        onClick={() =>
          onChange({ match, conditions: [...conditions, { field: fields[0].id, op: opsFor(fields[0])[0], value: "" }] })
        }
      >
        <Plus data-icon="inline-start" />
        Add condition
      </Button>
    </div>
  );
}
