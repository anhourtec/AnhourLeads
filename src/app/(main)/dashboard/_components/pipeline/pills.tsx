import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import {
  DEAL_STAGE_INFO,
  type DealStage,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/pipeline-constants";

export type Tone = "positive" | "neutral" | "attention" | "negative" | "info";

const TONES: Record<Tone, string> = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

/** Status pill: tinted background, matching text, no dot (BRANDING.md). */
export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

const TASK_STATUS_TONE: Record<TaskStatus, Tone> = { open: "info", completed: "positive", skipped: "neutral" };
const PRIORITY_TONE: Record<TaskPriority, Tone> = { high: "negative", medium: "attention", low: "neutral" };
const STAGE_TONE: Record<DealStage, Tone> = {
  qualify: "neutral",
  meeting: "info",
  proposal: "info",
  negotiation: "attention",
  won: "positive",
  lost: "negative",
};

export function TaskStatusPill({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  if (status === "open" && overdue) return <Pill tone="negative">Overdue</Pill>;
  return <Pill tone={TASK_STATUS_TONE[status]}>{TASK_STATUS_LABELS[status]}</Pill>;
}

export function PriorityPill({ priority }: { priority: TaskPriority }) {
  return <Pill tone={PRIORITY_TONE[priority]}>{TASK_PRIORITY_LABELS[priority]}</Pill>;
}

export function StagePill({ stage }: { stage: DealStage }) {
  return <Pill tone={STAGE_TONE[stage]}>{DEAL_STAGE_INFO[stage].name}</Pill>;
}
