"use client";

import { cn } from "cn";
import {
  ArrowRightLeft,
  Bell,
  Bot,
  CircleCheck,
  Clock,
  DatabaseZap,
  GitBranch,
  GitFork,
  Handshake,
  ListMinus,
  ListPlus,
  LogOut,
  type LucideIcon,
  Percent,
  Plus,
  Send,
  SendToBack,
  Sparkles,
  SquareCheck,
  UserPen,
  Webhook,
  Zap,
} from "lucide-react";

import {
  BLOCK_INFO,
  type BlockType,
  branchKeys,
  CONDITION_OP_LABELS,
  type WorkflowBlock,
  type WorkflowCondition,
} from "@/lib/workflows";

import { isTerminal, type Lane, sameLane } from "../../_components/tree";
import type { PickerData } from "./types";

export const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  branch_if: GitBranch,
  split_multi: GitFork,
  split_traffic: Percent,
  delay: Clock,
  exit: LogOut,
  research_ai: Sparkles,
  qualify_ai: Bot,
  add_to_sequence: Send,
  remove_from_sequence: SendToBack,
  add_to_list: ListPlus,
  remove_from_list: ListMinus,
  create_deal: Handshake,
  update_deal_stage: ArrowRightLeft,
  enrich: DatabaseZap,
  create_task: SquareCheck,
  update_record: UserPen,
  notify: Bell,
  webhook: Webhook,
};

function conditionsText(conditions: WorkflowCondition[] | undefined): string {
  if (!conditions?.length) return "No conditions yet";
  return conditions
    .map(
      (c) => `${c.field} ${CONDITION_OP_LABELS[c.op]}${c.value !== undefined && c.value !== "" ? ` ${c.value}` : ""}`,
    )
    .join("; ");
}

/** One-line summary of a block's settings (detail view). */
export function blockSummary(block: WorkflowBlock, data: PickerData): string {
  const c = block.config;
  const name = (list: { id: string; name: string }[], id: unknown) => list.find((x) => x.id === id)?.name;
  switch (block.type) {
    case "branch_if":
      return conditionsText(c.conditions as WorkflowCondition[]);
    case "split_multi":
      return `${((c.cases as unknown[] | undefined) ?? []).length} paths plus everyone else`;
    case "split_traffic":
      return ((c.splits as { percent: number }[] | undefined) ?? []).map((s) => `${s.percent}%`).join(" / ");
    case "delay":
      return `Wait ${String(c.amount)} ${String(c.unit)}`;
    case "add_to_list":
    case "remove_from_list":
      return name(data.lists, c.listId) ?? "Choose a list";
    case "add_to_sequence":
      return name(data.sequences, c.sequenceId) ?? "Choose a sequence";
    case "remove_from_sequence":
      return c.sequenceId && c.sequenceId !== "all"
        ? (name(data.sequences, c.sequenceId) ?? "Sequence")
        : "All sequences";
    case "create_task":
      return c.title ? String(c.title) : "Give the task a title";
    case "update_record":
      return c.value ? `${String(c.field)} → ${String(c.value)}` : "Choose the new value";
    case "create_deal":
      return c.name ? String(c.name) : "Named after the record";
    case "update_deal_stage":
      return data.pipelines.flatMap((p) => p.stages).find((s) => s.id === c.stageId)?.name ?? "Choose a stage";
    case "notify":
      return c.message ? String(c.message) : "Write the notification";
    case "webhook":
      return c.url ? String(c.url) : "Enter the URL";
    default:
      return BLOCK_INFO[block.type].description;
  }
}

function Connector() {
  return <span className="h-5 w-px bg-border" aria-hidden="true" />;
}

interface CanvasProps {
  readonly blocks: WorkflowBlock[];
  readonly data: PickerData;
  readonly detail: boolean;
  readonly activeLane: Lane;
  readonly selectedId: string | null;
  readonly readOnly: boolean;
  readonly onSelectBlock: (id: string) => void;
  readonly onSelectLane: (lane: Lane) => void;
}

function LaneView({ blocks, lane, props }: { blocks: WorkflowBlock[]; lane: Lane; props: CanvasProps }) {
  const last = blocks[blocks.length - 1];
  const ends = last && isTerminal(last.type);
  const active = sameLane(lane, props.activeLane);
  return (
    <div className="flex flex-col items-center">
      {blocks.map((b) => {
        const Icon = BLOCK_ICONS[b.type];
        const selected = props.selectedId === b.id;
        const keys = branchKeys(b);
        return (
          <div key={b.id} className="flex flex-col items-center">
            <Connector />
            {b.type === "exit" ? (
              <button
                type="button"
                onClick={() => props.onSelectBlock(b.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "ring-2 ring-primary",
                )}
              >
                <CircleCheck className="size-3.5" aria-hidden="true" />
                Exit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => props.onSelectBlock(b.id)}
                data-testid={`block-${b.type}`}
                className={cn(
                  "flex w-64 items-start gap-2.5 rounded-xl border bg-card p-3 text-left shadow-xs outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "border-primary ring-1 ring-primary",
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-sm">{BLOCK_INFO[b.type].label}</span>
                  {props.detail ? (
                    <span className="line-clamp-2 break-words text-muted-foreground text-xs">
                      {blockSummary(b, props.data)}
                    </span>
                  ) : null}
                </span>
              </button>
            )}
            {keys.length ? (
              <div className="flex items-start gap-6 pt-0">
                {keys.map(({ key, label }) => (
                  <div key={key} className="flex flex-col items-center">
                    <Connector />
                    <span className="rounded-full border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground uppercase tracking-wide">
                      {label}
                    </span>
                    <LaneView
                      blocks={b.branches?.[key] ?? []}
                      lane={{ parentId: b.id, branchKey: key }}
                      props={props}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {!props.readOnly ? (
        <>
          <Connector />
          <button
            type="button"
            onClick={() => props.onSelectLane(lane)}
            aria-pressed={active}
            aria-label={active ? "Blocks are added here" : "Add blocks here"}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary bg-primary text-primary-foreground hover:text-primary-foreground",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {!ends ? (
        <>
          <Connector />
          <span className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-muted-foreground text-xs">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            Exit
          </span>
        </>
      ) : null}
    </div>
  );
}

/** The flow: trigger card, then blocks top to bottom, branch paths side by side, each ending in Exit. */
export function Canvas(props: CanvasProps & { readonly trigger: React.ReactNode; readonly zoom: number }) {
  return (
    <div className="min-h-[28rem] overflow-auto rounded-xl border bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-muted/30 [background-size:16px_16px]">
      <div className="flex min-w-max justify-center p-6" style={{ zoom: props.zoom }}>
        <div className="flex flex-col items-center">
          <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-0.5 text-sky-700 text-xs dark:text-sky-400">
            <Zap className="size-3" aria-hidden="true" />
            When this happens
          </span>
          {props.trigger}
          <LaneView blocks={props.blocks} lane={{ parentId: null, branchKey: null }} props={props} />
        </div>
      </div>
    </div>
  );
}
