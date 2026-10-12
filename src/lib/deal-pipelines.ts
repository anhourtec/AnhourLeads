/**
 * Deal pipelines: stage types, the default pipeline and the mapping between configurable stages and
 * the legacy `deal.stage` values the overview and older API consumers read. Safe for client components.
 */
import type { DealStage } from "./pipeline-constants";

export const PIPELINE_STAGE_TYPES = ["open", "won", "lost"] as const;
export type PipelineStageType = (typeof PIPELINE_STAGE_TYPES)[number];

export const PIPELINE_STAGE_TYPE_LABELS: Record<PipelineStageType, string> = {
  open: "Open",
  won: "Closed won",
  lost: "Closed lost",
};

export interface StageDraft {
  name: string;
  type: PipelineStageType;
  probability: number | null;
}

export const DEFAULT_PIPELINE_NAME = "Pipeline 1";

/** The stages a new workspace starts with (deals → setup). Won and lost always come last. */
export const DEFAULT_PIPELINE_STAGES: StageDraft[] = [
  { name: "Lead", type: "open", probability: 10 },
  { name: "Sales qualified", type: "open", probability: 20 },
  { name: "Meeting booked", type: "open", probability: 40 },
  { name: "Negotiation", type: "open", probability: 60 },
  { name: "Contract sent", type: "open", probability: 80 },
  { name: "Closed won", type: "won", probability: 100 },
  { name: "Closed lost", type: "lost", probability: 0 },
];

/** Legacy stage → default stage name, used once to move existing deals onto the default pipeline. */
export const LEGACY_TO_DEFAULT_STAGE: Record<DealStage, string> = {
  qualify: "Lead",
  meeting: "Meeting booked",
  proposal: "Contract sent",
  negotiation: "Negotiation",
  won: "Closed won",
  lost: "Closed lost",
};

/**
 * The closest legacy value for a configurable stage: won/lost by type; open stages by name, then
 * by probability, then by position among the open stages.
 */
export function legacyStageFor(
  stage: { name: string; type: PipelineStageType; probability: number | null },
  openIndex = 0,
  openCount = 1,
): DealStage {
  if (stage.type === "won") return "won";
  if (stage.type === "lost") return "lost";
  const name = stage.name.toLowerCase();
  if (/negotiat/.test(name)) return "negotiation";
  if (/contract|proposal|quote/.test(name)) return "proposal";
  if (/meeting|demo|call/.test(name)) return "meeting";
  if (/lead|qualif|new|discover/.test(name)) return "qualify";
  if (stage.probability !== null) {
    if (stage.probability < 30) return "qualify";
    if (stage.probability < 50) return "meeting";
    if (stage.probability < 70) return "negotiation";
    return "proposal";
  }
  const share = openCount > 1 ? openIndex / (openCount - 1) : 0;
  if (share < 0.25) return "qualify";
  if (share < 0.5) return "meeting";
  if (share < 0.75) return "negotiation";
  return "proposal";
}

/** Validation shared by the API and the setup / settings forms. Returns a message, or null when fine. */
export function stageListProblem(stages: { name: string; type: PipelineStageType }[]): string | null {
  if (stages.filter((s) => s.type === "won").length !== 1) return "Keep exactly one closed won stage.";
  if (stages.filter((s) => s.type === "lost").length !== 1) return "Keep exactly one closed lost stage.";
  if (!stages.some((s) => s.type === "open")) return "Add at least one open stage.";
  const firstClosed = stages.findIndex((s) => s.type !== "open");
  if (stages.slice(firstClosed).some((s) => s.type === "open")) {
    return "Closed won and closed lost stay at the end of the pipeline.";
  }
  const names = stages.map((s) => s.name.trim().toLowerCase());
  if (names.some((n) => !n)) return "Name every stage.";
  if (new Set(names).size !== names.length) return "Give each stage a different name.";
  return null;
}
