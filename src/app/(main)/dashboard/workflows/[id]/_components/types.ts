import type { EnrollmentFilters, WorkflowBlock, WorkflowSchedule, WorkflowTarget } from "@/lib/workflows";

export interface PickerData {
  lists: { id: string; name: string; entityType: "contact" | "company"; kind: "static" | "dynamic" }[];
  sequences: { id: string; name: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  members: { id: string; name: string; email: string }[];
  contactStages: { key: string; label: string }[];
  companyStages: { key: string; label: string }[];
}

/** The editable part of a workflow (what Save sends). */
export interface Draft {
  name: string;
  description: string;
  allowReenroll: boolean;
  targetType: WorkflowTarget;
  triggerType: "event" | "schedule";
  triggerEvent: string | null;
  schedule: WorkflowSchedule | null;
  enrollmentFilters: EnrollmentFilters;
  blocks: WorkflowBlock[];
}
