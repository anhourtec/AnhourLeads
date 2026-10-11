"use client";

import { useRef } from "react";

import { cn } from "cn";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Clock, Copy, EllipsisVertical, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { describeWait, isEmailStep, STEP_TYPE_HINTS, STEP_TYPE_LABELS } from "@/lib/engage-constants";
import type { DetailedStats } from "@/server/services/sequences";

import { insertAtCursor, SnippetPicker } from "../../../../_components/engage/insert-pickers";
import { EmailStepBody } from "./email-step-body";
import { STEP_ICONS, type StepDraft } from "./model";

export interface StepCardActions {
  onChange: (patch: Partial<StepDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleCollapse: () => void;
}

const n = (v: number) => v.toLocaleString("en-US");

/** One step: header (on/off, type, version, timing, menu, collapse) and its editor. */
export function StepCard({
  sequenceId,
  step,
  index,
  total,
  canEdit,
  collapsed,
  stat,
  actions,
}: {
  sequenceId: string;
  step: StepDraft;
  index: number;
  total: number;
  canEdit: boolean;
  collapsed: boolean;
  stat: DetailedStats["steps"][number] | undefined;
  actions: StepCardActions;
}) {
  const Icon = STEP_ICONS[step.type];
  const position = index + 1;
  const activeLabels = step.variants.filter((v) => v.active).map((v) => v.label);
  const versionText =
    step.type === "auto_email"
      ? `Test ${activeLabels.length > 1 ? activeLabels.join(", ") : (activeLabels[0] ?? "A")}`
      : null;
  const timing = describeWait(step.waitDays, step.waitMinutes, index === 0, step.type);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const bodyId = `step-${step.key}-body`;

  return (
    <article
      id={`step-${position}`}
      data-testid={`step-card-${position}`}
      aria-label={`Step ${position}: ${STEP_TYPE_LABELS[step.type]}`}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-xl border bg-card text-card-foreground shadow-xs",
        !step.enabled && "opacity-70",
      )}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <Switch
          checked={step.enabled}
          disabled={!canEdit}
          onCheckedChange={(enabled) => actions.onChange({ enabled })}
          aria-label={`Step ${position} on`}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h3 className="min-w-0 truncate text-sm">
            <span className="text-muted-foreground">
              Step {position}: {STEP_TYPE_LABELS[step.type]}
            </span>
            {versionText ? <span className="font-medium"> / {versionText}</span> : null}
            {!step.enabled ? <span className="text-muted-foreground"> · Off</span> : null}
          </h3>
        </div>
        <span className="hidden items-center gap-1 text-muted-foreground text-xs sm:inline-flex">
          <Clock className="size-3.5" aria-hidden="true" />
          {timing}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={`Step ${position} actions`}>
                  <EllipsisVertical aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={index === 0} onSelect={() => actions.onMove(-1)}>
                  <ArrowUp aria-hidden="true" />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === total - 1} onSelect={() => actions.onMove(1)}>
                  <ArrowDown aria-hidden="true" />
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem disabled={total >= 30} onSelect={actions.onDuplicate}>
                  <Copy aria-hidden="true" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={actions.onDelete}>
                  <Trash2 aria-hidden="true" />
                  Delete step
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? `Expand step ${position}` : `Collapse step ${position}`}
            onClick={actions.onToggleCollapse}
          >
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </Button>
        </div>
      </header>
      {collapsed ? null : (
        <div id={bodyId} className="flex min-w-0 flex-col gap-3 border-t px-3 py-3 sm:px-4">
          <p className="text-muted-foreground text-xs sm:hidden">{timing}</p>
          {isEmailStep(step.type) ? (
            <EmailStepBody
              sequenceId={sequenceId}
              step={step}
              position={position}
              canEdit={canEdit}
              onChange={actions.onChange}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`step-${step.key}-note`} className="text-xs">
                  Task note
                </FieldLabel>
                <Textarea
                  id={`step-${step.key}-note`}
                  ref={noteRef}
                  rows={3}
                  value={step.body}
                  disabled={!canEdit}
                  placeholder={STEP_TYPE_HINTS[step.type]}
                  onChange={(e) => actions.onChange({ body: e.target.value })}
                />
              </Field>
              {canEdit ? (
                <div>
                  <SnippetPicker
                    onPick={(text) =>
                      actions.onChange({ body: insertAtCursor(noteRef.current, step.body, text).value })
                    }
                  />
                </div>
              ) : null}
            </div>
          )}
          {stat && (stat.sent || stat.pendingReview || stat.opened || stat.replied) ? (
            <p className="text-muted-foreground text-xs">
              <span className="font-mono tabular-nums">{n(stat.sent)}</span> sent ·{" "}
              <span className="font-mono tabular-nums">{n(stat.pendingReview)}</span> waiting for review ·{" "}
              <span className="font-mono tabular-nums">{n(stat.opened)}</span> opened ·{" "}
              <span className="font-mono tabular-nums">{n(stat.replied)}</span> replied
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
