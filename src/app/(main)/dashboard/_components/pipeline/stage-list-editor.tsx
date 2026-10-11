"use client";

import { useState } from "react";

import { cn } from "cn";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PIPELINE_STAGE_TYPE_LABELS, type PipelineStageType } from "@/lib/deal-pipelines";

export interface EditableStage {
  /** Stable client key (the stage id for saved stages). */
  key: string;
  id?: string;
  name: string;
  type: PipelineStageType;
  probability: number | null;
  dealCount?: number;
}

let counter = 0;
export function newStageKey(): string {
  counter += 1;
  return `new-${Date.now().toString(36)}-${counter}`;
}

/**
 * Ordered stage list: open stages are named, reordered (drag or arrows), added and removed; the
 * closed won and closed lost stages stay fixed at the end (their names can change in settings).
 */
export function StageListEditor({
  stages,
  onChange,
  readOnly = false,
  showProbability = false,
  renameClosed = false,
  label = "Stages",
}: {
  readonly stages: EditableStage[];
  readonly onChange: (stages: EditableStage[]) => void;
  readonly readOnly?: boolean;
  readonly showProbability?: boolean;
  readonly renameClosed?: boolean;
  readonly label?: string;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const open = stages.filter((s) => s.type === "open");
  const closed = stages.filter((s) => s.type !== "open");

  const setOpen = (next: EditableStage[]) => onChange([...next, ...closed]);
  const update = (key: string, patch: Partial<EditableStage>) =>
    onChange(stages.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= open.length) return;
    const next = [...open];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setOpen(next);
  };
  const dropOn = (overKey: string) => {
    if (!dragKey || dragKey === overKey) return;
    const from = open.findIndex((s) => s.key === dragKey);
    const to = open.findIndex((s) => s.key === overKey);
    if (from < 0 || to < 0) return;
    const next = [...open];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOpen(next);
  };

  const grid = cn(
    "grid items-center gap-2",
    showProbability
      ? "grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_auto]"
      : "grid-cols-[auto_minmax(0,1fr)_7rem_auto]",
  );

  const row = (s: EditableStage, index: number) => {
    const isOpen = s.type === "open";
    return (
      <li
        key={s.key}
        className={cn(grid, "rounded-md", dragKey === s.key && "opacity-50")}
        draggable={isOpen && !readOnly}
        onDragStart={(e) => {
          setDragKey(s.key);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", s.key);
        }}
        onDragOver={(e) => {
          if (isOpen && dragKey) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropOn(s.key);
          setDragKey(null);
        }}
        onDragEnd={() => setDragKey(null)}
        data-testid={`stage-row-${index}`}
      >
        <span className="flex w-5 justify-center text-muted-foreground">
          {isOpen && !readOnly ? <GripVertical className="size-4 cursor-grab" aria-hidden="true" /> : null}
        </span>
        <Input
          aria-label={`Stage ${index + 1} name`}
          value={s.name}
          maxLength={60}
          disabled={readOnly ? true : !isOpen && !renameClosed}
          onChange={(e) => update(s.key, { name: e.target.value })}
          className="h-8"
        />
        <span
          className={cn(
            "h-8 items-center rounded-md border bg-muted/50 px-2.5 text-muted-foreground text-sm",
            showProbability ? "hidden sm:flex" : "flex",
          )}
        >
          {PIPELINE_STAGE_TYPE_LABELS[s.type]}
        </span>
        {showProbability ? (
          <div className="relative hidden sm:block">
            <Input
              aria-label={`Stage ${index + 1} probability`}
              inputMode="numeric"
              value={s.probability ?? ""}
              disabled={readOnly ? true : !isOpen}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                update(s.key, { probability: digits === "" ? null : Math.min(100, Number(digits)) });
              }}
              className="h-8 pr-6 font-mono tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground text-xs">
              %
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-0.5">
          {isOpen && !readOnly ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${s.name || "stage"} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className="hidden sm:inline-flex"
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${s.name || "stage"} down`}
                disabled={index === open.length - 1}
                onClick={() => move(index, 1)}
                className="hidden sm:inline-flex"
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${s.name || "stage"}`}
                disabled={open.length <= 1}
                onClick={() => setOpen(open.filter((o) => o.key !== s.key))}
              >
                <Trash2 />
              </Button>
            </>
          ) : (
            <span className="w-8" aria-hidden="true" />
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className={cn(grid, "px-0")}>
        <span className="w-5" aria-hidden="true" />
        <span className="table-head-mono">Stage name</span>
        <span className={cn("table-head-mono", showProbability && "hidden sm:block")}>Stage type</span>
        {showProbability ? <span className="table-head-mono hidden sm:block">Win %</span> : null}
        <span className="w-8" aria-hidden="true" />
      </div>
      <ol className="flex flex-col gap-2" aria-label={label}>
        {open.map((s, i) => row(s, i))}
        {closed.map((s, i) => row(s, open.length + i))}
      </ol>
      {!readOnly ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen([...open, { key: newStageKey(), name: "", type: "open", probability: null }])}
          >
            <Plus data-icon="inline-start" />
            Add stage
          </Button>
        </div>
      ) : null}
    </div>
  );
}
