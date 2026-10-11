"use client";

import { useEffect, useState } from "react";

import { cn } from "cn";
import { CalendarClock, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-fetch";
import { formatNumber } from "@/lib/format-display";
import { EMAIL_STATUS_LABELS, EMAIL_STATUSES } from "@/lib/records-vocabulary";
import {
  describeFilters,
  type EnrollmentFilters,
  TRIGGER_EVENTS,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Weekday,
  WORKFLOW_TARGET_LABELS,
  WORKFLOW_TARGETS,
  type WorkflowTarget,
} from "@/lib/workflows";

import type { Draft, PickerData } from "./types";

type TriggerDraft = Pick<Draft, "targetType" | "triggerType" | "triggerEvent" | "schedule" | "enrollmentFilters">;

const GROUPS = ["People", "Email", "Sequences", "Deals", "Activity", "Meetings", "Inbound"] as const;

function Multi({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="table-head-mono mb-1">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => {
          const id = `f-${label}-${o.value}`;
          return (
            <div key={o.value} className="flex items-center gap-1.5">
              <Checkbox
                id={id}
                checked={value.includes(o.value)}
                disabled={disabled}
                onCheckedChange={(c) => onChange(c === true ? [...value, o.value] : value.filter((v) => v !== o.value))}
              />
              <Label htmlFor={id} className="font-normal text-sm">
                {o.label}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function FiltersEditor({
  target,
  filters,
  data,
  disabled,
  onChange,
}: {
  target: WorkflowTarget;
  filters: EnrollmentFilters;
  data: PickerData;
  disabled: boolean;
  onChange: (next: EnrollmentFilters) => void;
}) {
  const set = (patch: EnrollmentFilters) => {
    const next: EnrollmentFilters = { ...filters, ...patch };
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
        delete next[k as keyof EnrollmentFilters];
    }
    onChange(next);
  };
  const csv = (v: string) =>
    v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const lists = data.lists.filter((l) => l.entityType === (target === "company" ? "company" : "contact"));
  const owner = (
    <Field>
      <FieldLabel htmlFor="f-owner">Owner</FieldLabel>
      <NativeSelect
        id="f-owner"
        value={filters.ownerId ?? ""}
        disabled={disabled}
        onChange={(e) => set({ ownerId: e.target.value || undefined })}
        className="w-full"
      >
        <NativeSelectOption value="">Anyone</NativeSelectOption>
        {data.members.map((m) => (
          <NativeSelectOption key={m.id} value={m.id}>
            {m.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
  if (target === "deal") {
    const pipeline = data.pipelines.find((p) => p.id === filters.pipelineId);
    return (
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="f-pipeline">Pipeline</FieldLabel>
          <NativeSelect
            id="f-pipeline"
            value={filters.pipelineId ?? ""}
            disabled={disabled}
            onChange={(e) => set({ pipelineId: e.target.value || undefined, stageIds: undefined })}
            className="w-full"
          >
            <NativeSelectOption value="">Any pipeline</NativeSelectOption>
            {data.pipelines.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {pipeline ? (
          <Multi
            label="Stage"
            options={pipeline.stages.map((s) => ({ value: s.id, label: s.name }))}
            value={filters.stageIds ?? []}
            disabled={disabled}
            onChange={(v) => set({ stageIds: v })}
          />
        ) : null}
        {owner}
        <Field>
          <FieldLabel htmlFor="f-amount">Amount at least</FieldLabel>
          <Input
            id="f-amount"
            inputMode="numeric"
            value={filters.amountMin?.toString() ?? ""}
            disabled={disabled}
            onChange={(e) =>
              set({
                amountMin: e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : undefined,
              })
            }
          />
        </Field>
      </div>
    );
  }
  const stages = target === "company" ? data.companyStages : data.contactStages;
  return (
    <div className="flex flex-col gap-3">
      <Multi
        label="Stage"
        options={stages.map((s) => ({ value: s.key, label: s.label }))}
        value={filters.stage ?? []}
        disabled={disabled}
        onChange={(v) => set({ stage: v })}
      />
      {target === "contact" ? (
        <>
          <Multi
            label="Email status"
            options={EMAIL_STATUSES.map((s) => ({ value: s, label: EMAIL_STATUS_LABELS[s] }))}
            value={filters.emailStatus ?? []}
            disabled={disabled}
            onChange={(v) => set({ emailStatus: v })}
          />
          <Field>
            <FieldLabel htmlFor="f-title">Job title contains</FieldLabel>
            <Input
              id="f-title"
              value={filters.title ?? ""}
              disabled={disabled}
              placeholder="Head of sales, VP"
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
        </>
      ) : (
        <Field>
          <FieldLabel htmlFor="f-industry">Industry (comma separated)</FieldLabel>
          <Input
            id="f-industry"
            defaultValue={(filters.industry ?? []).join(", ")}
            disabled={disabled}
            onBlur={(e) => set({ industry: csv(e.target.value) })}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="f-country">Country (comma separated)</FieldLabel>
        <Input
          id="f-country"
          defaultValue={(filters.country ?? []).join(", ")}
          disabled={disabled}
          onBlur={(e) => set({ country: csv(e.target.value) })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="f-list">In list</FieldLabel>
        <NativeSelect
          id="f-list"
          value={filters.listId ?? ""}
          disabled={disabled}
          onChange={(e) => set({ listId: e.target.value || undefined })}
          className="w-full"
        >
          <NativeSelectOption value="">Any list or none</NativeSelectOption>
          {lists.map((l) => (
            <NativeSelectOption key={l.id} value={l.id}>
              {l.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {owner}
    </div>
  );
}

/** Trigger panel: date/schedule or event, target record type, and enrollment criteria with a live count. */
export function TriggerSheet({
  open,
  onOpenChange,
  value,
  data,
  readOnly,
  onChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly value: TriggerDraft;
  readonly data: PickerData;
  readonly readOnly: boolean;
  readonly onChange: (patch: Partial<TriggerDraft>) => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      const res = await apiFetch<{ count: number }>("/api/v1/workflows/enrollment_count", {
        method: "POST",
        body: { targetType: value.targetType, enrollmentFilters: value.enrollmentFilters },
      });
      setCount(res.ok ? res.data.count : null);
    }, 300);
    return () => clearTimeout(timer);
  }, [open, value.targetType, value.enrollmentFilters]);

  const events = TRIGGER_EVENTS.filter((e) => e.targets.includes(value.targetType));
  const weekly = value.schedule?.weekly;
  const timezone = value.schedule?.timezone ?? "UTC";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>Trigger</SheetTitle>
          <SheetDescription>Choose what starts the workflow and who can enter it.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4">
          <section className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
            <h3 className="font-medium text-sm">Run this workflow</h3>
            {(
              [
                {
                  id: "schedule",
                  icon: CalendarClock,
                  title: "Based on a date or schedule",
                  text: "For example once on a date, or every Monday and Wednesday.",
                },
                {
                  id: "event",
                  icon: Zap,
                  title: "Based on a trigger event",
                  text: "For example when someone replies or a deal is won.",
                },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={readOnly}
                aria-pressed={value.triggerType === o.id}
                onClick={() =>
                  onChange(
                    o.id === "schedule"
                      ? {
                          triggerType: "schedule",
                          triggerEvent: null,
                          schedule: value.schedule ?? { weekly: { days: ["mon"], time: "09:00" }, timezone: "UTC" },
                        }
                      : { triggerType: "event", schedule: null },
                  )
                }
                className={cn(
                  "flex items-start gap-3 rounded-lg border bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  value.triggerType === o.id && "border-primary ring-1 ring-primary",
                )}
              >
                <o.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-sm">{o.title}</span>
                  <span className="text-muted-foreground text-xs">{o.text}</span>
                </span>
              </button>
            ))}
          </section>

          <div className="flex flex-col gap-1.5">
            <span className="table-head-mono" id="target-label">
              Records
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={value.targetType}
              disabled={readOnly}
              aria-labelledby="target-label"
              onValueChange={(v) => {
                if (!v) return;
                const target = v as WorkflowTarget;
                const keep = TRIGGER_EVENTS.find((e) => e.id === value.triggerEvent)?.targets.includes(target);
                onChange({ targetType: target, enrollmentFilters: {}, ...(keep ? {} : { triggerEvent: null }) });
              }}
            >
              {WORKFLOW_TARGETS.map((t) => (
                <ToggleGroupItem key={t} value={t}>
                  {WORKFLOW_TARGET_LABELS[t]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {value.triggerType === "event" ? (
            <Field>
              <FieldLabel htmlFor="trigger-event">Event</FieldLabel>
              <NativeSelect
                id="trigger-event"
                value={value.triggerEvent ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange({ triggerEvent: e.target.value || null })}
                className="w-full"
              >
                <NativeSelectOption value="">Choose an event</NativeSelectOption>
                {GROUPS.map((g) => {
                  const inGroup = events.filter((e) => e.group === g);
                  if (!inGroup.length) return null;
                  return (
                    <optgroup key={g} label={g}>
                      {inGroup.map((e) => (
                        <NativeSelectOption key={e.id} value={e.id} disabled={!e.available}>
                          {e.available ? e.label : `${e.label} (not available yet)`}
                        </NativeSelectOption>
                      ))}
                    </optgroup>
                  );
                })}
              </NativeSelect>
            </Field>
          ) : (
            <div className="flex flex-col gap-3">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={weekly ? "weekly" : "once"}
                disabled={readOnly}
                aria-label="Schedule type"
                onValueChange={(v) =>
                  v &&
                  onChange({
                    schedule:
                      v === "weekly"
                        ? { weekly: { days: ["mon"], time: "09:00" }, timezone }
                        : { at: new Date(Date.now() + 3_600_000).toISOString(), timezone },
                  })
                }
              >
                <ToggleGroupItem value="once">Once</ToggleGroupItem>
                <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
              </ToggleGroup>
              {weekly ? (
                <>
                  <fieldset className="flex flex-wrap gap-1.5">
                    <legend className="table-head-mono mb-1">Days</legend>
                    {WEEKDAYS.map((d) => {
                      const on = weekly.days.includes(d);
                      return (
                        <Button
                          key={d}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          aria-pressed={on}
                          disabled={readOnly}
                          onClick={() => {
                            const days: Weekday[] = on ? weekly.days.filter((x) => x !== d) : [...weekly.days, d];
                            if (days.length) onChange({ schedule: { weekly: { ...weekly, days }, timezone } });
                          }}
                        >
                          {WEEKDAY_LABELS[d]}
                        </Button>
                      );
                    })}
                  </fieldset>
                  <Field>
                    <FieldLabel htmlFor="sched-time">Time</FieldLabel>
                    <Input
                      id="sched-time"
                      type="time"
                      value={weekly.time}
                      disabled={readOnly}
                      onChange={(e) =>
                        e.target.value &&
                        onChange({ schedule: { weekly: { ...weekly, time: e.target.value }, timezone } })
                      }
                    />
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="sched-at">Date and time</FieldLabel>
                  <Input
                    id="sched-at"
                    type="datetime-local"
                    value={value.schedule?.at ? value.schedule.at.slice(0, 16) : ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      e.target.value && onChange({ schedule: { at: new Date(e.target.value).toISOString(), timezone } })
                    }
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="sched-tz">Time zone</FieldLabel>
                <Input
                  id="sched-tz"
                  defaultValue={timezone}
                  disabled={readOnly}
                  onBlur={(e) =>
                    onChange({ schedule: { ...(value.schedule ?? {}), timezone: e.target.value.trim() || "UTC" } })
                  }
                  className="font-mono"
                />
              </Field>
            </div>
          )}

          <section className="flex flex-col gap-3 rounded-xl bg-muted/50 p-3" aria-labelledby="criteria-title">
            <h3 id="criteria-title" className="font-medium text-sm">
              Enrollment criteria
            </h3>
            <div className="rounded-lg border bg-card p-3 text-sm">
              <p>{WORKFLOW_TARGET_LABELS[value.targetType]} matching these attributes</p>
              <p className="font-medium" data-testid="prequalified">
                Pre-qualified:{" "}
                <span className="font-mono tabular-nums">{count === null ? "…" : formatNumber(count)}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {value.triggerType === "event"
                  ? "Records enroll when the event happens and they match."
                  : "Everyone matching enrolls at each scheduled run (up to 1,000)."}
              </p>
              <p className="mt-2 border-t pt-2 text-muted-foreground text-xs">
                {describeFilters(value.enrollmentFilters)}
              </p>
            </div>
            <FiltersEditor
              target={value.targetType}
              filters={value.enrollmentFilters}
              data={data}
              disabled={readOnly}
              onChange={(enrollmentFilters) => onChange({ enrollmentFilters })}
            />
          </section>
        </div>
        <SheetFooter className="mt-auto border-t">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
