import { RUN_STATUS_LABELS, type RunStatus, WORKFLOW_STATUS_LABELS, type WorkflowStatus } from "@/lib/workflows";

import { Pill, type Tone } from "../../_components/pipeline/pills";

const WF_TONE: Record<WorkflowStatus, Tone> = {
  draft: "neutral",
  active: "positive",
  paused: "attention",
  archived: "neutral",
};
const RUN_TONE: Record<RunStatus, Tone> = {
  running: "info",
  waiting: "attention",
  completed: "positive",
  failed: "negative",
  exited: "neutral",
};

export function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  return <Pill tone={WF_TONE[status]}>{WORKFLOW_STATUS_LABELS[status]}</Pill>;
}

export function RunStatusPill({ status }: { status: RunStatus }) {
  return <Pill tone={RUN_TONE[status]}>{RUN_STATUS_LABELS[status]}</Pill>;
}
