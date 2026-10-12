import { Briefcase, ListChecks, Mail, Phone, SquareCheck } from "lucide-react";

import type { TaskType } from "@/lib/pipeline-constants";

export const TASK_TABS = ["all", "call", "email", "linkedin", "overdue"] as const;
export type TaskTab = (typeof TASK_TABS)[number];
export const TASK_TAB_LABELS: Record<TaskTab, string> = {
  all: "All tasks",
  call: "Call tasks",
  email: "Email tasks",
  linkedin: "LinkedIn tasks",
  overdue: "Overdue tasks",
};

export const TASK_SORTS = ["due_at", "priority", "created_at", "title"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];
export const TASK_SORT_LABELS: Record<TaskSort, string> = {
  due_at: "Due date",
  priority: "Priority",
  created_at: "Newest first",
  title: "Title",
};

export const TASK_TYPE_ICONS: Record<TaskType, typeof Phone> = {
  call: Phone,
  email: Mail,
  action_item: SquareCheck,
  linkedin: Briefcase,
  linkedin_connect: Briefcase,
  linkedin_message: Briefcase,
  linkedin_view: Briefcase,
  linkedin_interact: Briefcase,
};

export const DefaultTaskIcon = ListChecks;
