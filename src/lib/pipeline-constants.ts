/**
 * Labels and enums for tasks, deals and the do-not-contact list, safe to import from client
 * components. They mirror the enums in src/server/db/schema.ts.
 */

export const DEAL_STAGES = ["qualify", "meeting", "proposal", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_INFO: Record<
  DealStage,
  { name: string; probability: number; isWon: boolean; isClosed: boolean; description: string }
> = {
  qualify: { name: "Qualify", probability: 10, isWon: false, isClosed: false, description: "Checking fit and need." },
  meeting: { name: "Meeting", probability: 25, isWon: false, isClosed: false, description: "A meeting is booked." },
  proposal: { name: "Proposal", probability: 50, isWon: false, isClosed: false, description: "Proposal sent." },
  negotiation: { name: "Negotiation", probability: 75, isWon: false, isClosed: false, description: "Agreeing terms." },
  won: { name: "Won", probability: 100, isWon: true, isClosed: true, description: "Signed." },
  lost: { name: "Lost", probability: 0, isWon: false, isClosed: true, description: "Did not go ahead." },
};

export const OPEN_DEAL_STAGES = DEAL_STAGES.filter((s) => !DEAL_STAGE_INFO[s].isClosed);

export const TASK_TYPES = [
  "call",
  "email",
  "action_item",
  "linkedin_connect",
  "linkedin_message",
  "linkedin_view",
  "linkedin_interact",
  "linkedin",
] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_STATUSES = ["open", "completed", "skipped"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  call: "Call",
  email: "Email",
  linkedin: "LinkedIn",
  action_item: "Action item",
  linkedin_connect: "LinkedIn: send connection request",
  linkedin_message: "LinkedIn: send message",
  linkedin_view: "LinkedIn: view profile",
  linkedin_interact: "LinkedIn: interact with post",
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High" };
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  completed: "Completed",
  skipped: "Skipped",
};

export const SUPPRESSION_REASONS = ["manual", "unsubscribed", "bounced", "complaint", "erasure_request"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];
export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  manual: "Added manually",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complaint: "Complaint",
  erasure_request: "Erasure request",
};
