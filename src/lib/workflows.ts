/**
 * Workflow vocabulary shared by the API, the engine and the builder: targets, trigger events,
 * block types, condition fields and operators. Safe for client components.
 */

export const WORKFLOW_TARGETS = ["contact", "company", "deal"] as const;
export type WorkflowTarget = (typeof WORKFLOW_TARGETS)[number];
export const WORKFLOW_TARGET_LABELS: Record<WorkflowTarget, string> = {
  contact: "People",
  company: "Companies",
  deal: "Deals",
};

export const WORKFLOW_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

export const RUN_STATUSES = ["running", "waiting", "completed", "failed", "exited"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  exited: "Exited",
};

/* -------------------------------------------------------------------------- */
/* Trigger events                                                             */
/* -------------------------------------------------------------------------- */

export interface TriggerEventInfo {
  id: string;
  label: string;
  group: "People" | "Email" | "Sequences" | "Deals" | "Activity" | "Meetings" | "Inbound";
  /** Which targets the event can enroll. */
  targets: WorkflowTarget[];
  /** False for events the app doesn't produce yet (forms, meetings, conversations, website visits). */
  available: boolean;
}

const PEOPLE: WorkflowTarget[] = ["contact", "company"];

export const TRIGGER_EVENTS: TriggerEventInfo[] = [
  { id: "contact_created", label: "Person saved or created", group: "People", targets: PEOPLE, available: true },
  { id: "contact_updated", label: "Person updated", group: "People", targets: PEOPLE, available: true },
  { id: "stage_changed", label: "Stage changed", group: "People", targets: PEOPLE, available: true },
  { id: "contact_added_to_list", label: "Added to a list", group: "People", targets: PEOPLE, available: true },
  { id: "marked_interested", label: "Marked interested", group: "People", targets: PEOPLE, available: true },
  { id: "email_sent", label: "Email sent", group: "Email", targets: PEOPLE, available: true },
  { id: "email_delivered", label: "Email delivered", group: "Email", targets: PEOPLE, available: true },
  { id: "email_opened", label: "Email opened", group: "Email", targets: PEOPLE, available: true },
  { id: "email_clicked", label: "Link clicked", group: "Email", targets: PEOPLE, available: true },
  { id: "email_replied", label: "Email replied", group: "Email", targets: PEOPLE, available: true },
  { id: "email_bounced", label: "Email bounced", group: "Email", targets: PEOPLE, available: true },
  { id: "email_not_sent", label: "Email not sent", group: "Email", targets: PEOPLE, available: true },
  { id: "email_unsubscribed", label: "Unsubscribed", group: "Email", targets: PEOPLE, available: true },
  { id: "spam_blocked", label: "Blocked as spam", group: "Email", targets: PEOPLE, available: true },
  {
    id: "contact_added_to_sequence",
    label: "Added to a sequence",
    group: "Sequences",
    targets: PEOPLE,
    available: true,
  },
  {
    id: "contact_finished_step",
    label: "Finished a sequence step",
    group: "Sequences",
    targets: PEOPLE,
    available: true,
  },
  {
    id: "contact_finished_sequence",
    label: "Finished a sequence",
    group: "Sequences",
    targets: PEOPLE,
    available: true,
  },
  {
    id: "contact_unresponsive",
    label: "No response after the last step",
    group: "Sequences",
    targets: PEOPLE,
    available: true,
  },
  {
    id: "deal_created",
    label: "Deal created",
    group: "Deals",
    targets: ["deal", "contact", "company"],
    available: true,
  },
  {
    id: "deal_stage_changed",
    label: "Deal stage changed",
    group: "Deals",
    targets: ["deal", "contact", "company"],
    available: true,
  },
  { id: "call_logged", label: "Call logged", group: "Activity", targets: PEOPLE, available: true },
  { id: "task_created", label: "Task created", group: "Activity", targets: PEOPLE, available: true },
  { id: "task_completed", label: "Task completed", group: "Activity", targets: PEOPLE, available: true },
  {
    id: "note_added",
    label: "Note added",
    group: "Activity",
    targets: ["contact", "company", "deal"],
    available: true,
  },
  { id: "meeting_booked", label: "Meeting booked", group: "Meetings", targets: PEOPLE, available: false },
  { id: "meeting_rescheduled", label: "Meeting rescheduled", group: "Meetings", targets: PEOPLE, available: false },
  { id: "meeting_cancelled", label: "Meeting cancelled", group: "Meetings", targets: PEOPLE, available: false },
  { id: "meeting_declined", label: "Meeting declined", group: "Meetings", targets: PEOPLE, available: false },
  { id: "meeting_incomplete", label: "Meeting not completed", group: "Meetings", targets: PEOPLE, available: false },
  { id: "conversation_recorded", label: "Conversation recorded", group: "Meetings", targets: PEOPLE, available: false },
  { id: "invitees_no_show", label: "Invitees didn't attend", group: "Meetings", targets: PEOPLE, available: false },
  { id: "form_submitted", label: "Form submitted", group: "Inbound", targets: PEOPLE, available: false },
  { id: "form_abandoned", label: "Form abandoned", group: "Inbound", targets: PEOPLE, available: false },
  { id: "website_visited", label: "Website visited", group: "Inbound", targets: ["company"], available: false },
];

export const AVAILABLE_TRIGGER_EVENTS = TRIGGER_EVENTS.filter((e) => e.available).map((e) => e.id);

export function triggerEventLabel(id: string | null | undefined): string {
  return TRIGGER_EVENTS.find((e) => e.id === id)?.label ?? "No trigger yet";
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export interface WorkflowSchedule {
  /** One run at this instant (ISO). */
  at?: string;
  /** Repeating weekly at a local time. */
  weekly?: { days: Weekday[]; time: string };
  timezone: string;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

export const RULE_BLOCKS = ["branch_if", "split_multi", "split_traffic", "delay", "exit"] as const;
export const AGENT_BLOCKS = ["research_ai", "qualify_ai"] as const;
export const ACTION_BLOCKS = [
  "add_to_sequence",
  "remove_from_sequence",
  "add_to_list",
  "remove_from_list",
  "create_deal",
  "update_deal_stage",
  "enrich",
  "create_task",
  "update_record",
  "notify",
  "webhook",
] as const;
export const BLOCK_TYPES = [...RULE_BLOCKS, ...AGENT_BLOCKS, ...ACTION_BLOCKS] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BRANCHING_BLOCKS: BlockType[] = ["branch_if", "split_multi", "split_traffic"];

export const BLOCK_INFO: Record<
  BlockType,
  { label: string; description: string; group: "Rules" | "Agents" | "Actions" }
> = {
  branch_if: { label: "True / false branch", description: "Split on a condition: yes or no.", group: "Rules" },
  split_multi: {
    label: "Multi-split branch",
    description: "Send records down the first matching path.",
    group: "Rules",
  },
  split_traffic: { label: "Traffic split", description: "Divide records between paths by percentage.", group: "Rules" },
  delay: { label: "Delay", description: "Wait before the next step.", group: "Rules" },
  exit: { label: "Exit", description: "Stop the workflow for this record.", group: "Rules" },
  research_ai: {
    label: "Research with AI",
    description: "Summarise public information about the record.",
    group: "Agents",
  },
  qualify_ai: { label: "Qualify records", description: "Score the record against your criteria.", group: "Agents" },
  add_to_sequence: { label: "Add to sequence", description: "Enroll the person in a sequence.", group: "Actions" },
  remove_from_sequence: {
    label: "Remove from sequence",
    description: "Stop their sequence enrollments.",
    group: "Actions",
  },
  add_to_list: { label: "Add to list", description: "Add the record to a static list.", group: "Actions" },
  remove_from_list: { label: "Remove from list", description: "Take the record off a list.", group: "Actions" },
  create_deal: { label: "Create deal", description: "Open a deal for the record.", group: "Actions" },
  update_deal_stage: { label: "Move deal stage", description: "Move the deal to another stage.", group: "Actions" },
  enrich: { label: "Enrich data", description: "Find and verify contact details.", group: "Actions" },
  create_task: { label: "Assign a task", description: "Create a manual task for a teammate.", group: "Actions" },
  update_record: { label: "Update record", description: "Change the stage, owner or a field.", group: "Actions" },
  notify: { label: "Send notification", description: "Notify teammates in the app.", group: "Actions" },
  webhook: { label: "Send webhook", description: "POST the record as JSON to your endpoint.", group: "Actions" },
};

export interface WorkflowCondition {
  field: string;
  op: ConditionOp;
  value?: string | number | null;
}

export interface WorkflowBlock {
  id: string;
  type: BlockType;
  config: Record<string, unknown>;
  /** Child paths of branching blocks: yes/no, case keys plus "else", or split keys. */
  branches?: Record<string, WorkflowBlock[]>;
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

export const CONDITION_OPS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "gt",
  "lt",
  "is_empty",
  "is_not_empty",
  "in_list",
  "not_in_list",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  gt: "is more than",
  lt: "is less than",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  in_list: "is in list",
  not_in_list: "is not in list",
};

export interface ConditionField {
  id: string;
  label: string;
  kind: "text" | "number" | "enum" | "list" | "member" | "stage";
  options?: { value: string; label: string }[];
}

export const CONTACT_CONDITION_FIELDS: ConditionField[] = [
  { id: "stage", label: "Stage", kind: "stage" },
  { id: "emailStatus", label: "Email status", kind: "enum" },
  { id: "title", label: "Job title", kind: "text" },
  { id: "seniority", label: "Seniority", kind: "enum" },
  { id: "country", label: "Country", kind: "text" },
  { id: "email", label: "Email", kind: "text" },
  { id: "tags", label: "Tags", kind: "text" },
  { id: "ownerId", label: "Owner", kind: "member" },
  { id: "list", label: "List membership", kind: "list" },
];

export const COMPANY_CONDITION_FIELDS: ConditionField[] = [
  { id: "stage", label: "Stage", kind: "stage" },
  { id: "industry", label: "Industry", kind: "text" },
  { id: "country", label: "Country", kind: "text" },
  { id: "employeeCount", label: "Employees", kind: "number" },
  { id: "ownerId", label: "Owner", kind: "member" },
  { id: "list", label: "List membership", kind: "list" },
];

export const DEAL_CONDITION_FIELDS: ConditionField[] = [
  {
    id: "stageType",
    label: "Stage type",
    kind: "enum",
    options: [
      { value: "open", label: "Open" },
      { value: "won", label: "Closed won" },
      { value: "lost", label: "Closed lost" },
    ],
  },
  { id: "stageName", label: "Stage name", kind: "text" },
  { id: "amount", label: "Amount", kind: "number" },
  { id: "name", label: "Deal name", kind: "text" },
  { id: "ownerId", label: "Owner", kind: "member" },
];

export function conditionFields(target: WorkflowTarget): ConditionField[] {
  if (target === "company") return COMPANY_CONDITION_FIELDS;
  if (target === "deal") return DEAL_CONDITION_FIELDS;
  return CONTACT_CONDITION_FIELDS;
}

/* -------------------------------------------------------------------------- */
/* Enrollment filters (people search shape, a subset)                         */
/* -------------------------------------------------------------------------- */

export interface EnrollmentFilters {
  stage?: string[];
  emailStatus?: string[];
  title?: string;
  country?: string[];
  seniority?: string[];
  tags?: string[];
  industry?: string[];
  listId?: string;
  ownerId?: string;
  employeesMin?: number;
  employeesMax?: number;
  pipelineId?: string;
  stageIds?: string[];
  amountMin?: number;
}

export function describeFilters(filters: EnrollmentFilters): string {
  const parts: string[] = [];
  if (filters.stage?.length) parts.push(`stage is ${filters.stage.join(" or ")}`);
  if (filters.emailStatus?.length) parts.push(`email ${filters.emailStatus.join(" or ")}`);
  if (filters.title) parts.push(`title contains "${filters.title}"`);
  if (filters.country?.length) parts.push(`in ${filters.country.join(", ")}`);
  if (filters.seniority?.length) parts.push(`seniority ${filters.seniority.join(", ")}`);
  if (filters.industry?.length) parts.push(`industry ${filters.industry.join(", ")}`);
  if (filters.listId) parts.push("in the chosen list");
  if (filters.ownerId) parts.push("owned by the chosen teammate");
  if (filters.employeesMin !== undefined) parts.push(`at least ${filters.employeesMin} employees`);
  if (filters.employeesMax !== undefined) parts.push(`at most ${filters.employeesMax} employees`);
  if (filters.stageIds?.length) parts.push(`in ${filters.stageIds.length} chosen stages`);
  if (filters.amountMin !== undefined) parts.push(`amount at least ${filters.amountMin}`);
  return parts.length ? parts.join(" · ") : "Anyone";
}

/* -------------------------------------------------------------------------- */
/* Tree helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Branch keys of a branching block, in display order. */
export function branchKeys(block: Pick<WorkflowBlock, "type" | "config">): { key: string; label: string }[] {
  if (block.type === "branch_if") {
    return [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
    ];
  }
  if (block.type === "split_multi") {
    const cases = Array.isArray(block.config.cases) ? (block.config.cases as { key: string; label?: string }[]) : [];
    return [
      ...cases.map((c, i) => ({ key: c.key, label: c.label || `Path ${i + 1}` })),
      { key: "else", label: "Everyone else" },
    ];
  }
  if (block.type === "split_traffic") {
    const splits = Array.isArray(block.config.splits)
      ? (block.config.splits as { key: string; percent: number; label?: string }[])
      : [];
    return splits.map((s, i) => ({
      key: s.key,
      label: `${s.label || `Path ${String.fromCharCode(65 + i)}`} · ${s.percent}%`,
    }));
  }
  return [];
}

export function countBlocks(blocks: WorkflowBlock[]): number {
  return blocks.reduce(
    (n, b) => n + 1 + Object.values(b.branches ?? {}).reduce((m, child) => m + countBlocks(child), 0),
    0,
  );
}

export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

/** A new block with sensible default config (branches prepared for branching types). */
export function makeBlock(type: BlockType): WorkflowBlock {
  const id = newBlockId();
  switch (type) {
    case "branch_if":
      return { id, type, config: { match: "all", conditions: [] }, branches: { yes: [], no: [] } };
    case "split_multi":
      return {
        id,
        type,
        config: {
          cases: [
            { key: "c1", label: "Path 1", match: "all", conditions: [] },
            { key: "c2", label: "Path 2", match: "all", conditions: [] },
          ],
        },
        branches: { c1: [], c2: [], else: [] },
      };
    case "split_traffic":
      return {
        id,
        type,
        config: {
          splits: [
            { key: "a", percent: 50 },
            { key: "b", percent: 50 },
          ],
        },
        branches: { a: [], b: [] },
      };
    case "delay":
      return { id, type, config: { amount: 1, unit: "days" } };
    case "create_task":
      return {
        id,
        type,
        config: { title: "", taskType: "action_item", priority: "medium", dueInDays: 1, assignee: "owner" },
      };
    case "update_record":
      return { id, type, config: { field: "stage", value: "" } };
    case "notify":
      return { id, type, config: { recipients: "owner", message: "" } };
    case "remove_from_sequence":
      return { id, type, config: { sequenceId: "all" } };
    default:
      return { id, type, config: {} };
  }
}

/**
 * People / company search filters (src/lib/search/filters.ts state) → enrollment criteria. Returns
 * the criteria plus the filter keys that have no enrollment equivalent yet.
 */
export function enrollmentFromSearch(
  entity: "contact" | "company",
  filters: Record<string, string | string[]>,
): { filters: EnrollmentFilters; dropped: string[] } {
  const list = (v: string | string[] | undefined): string[] => {
    if (Array.isArray(v)) return v.filter(Boolean);
    return v ? [v] : [];
  };
  const out: EnrollmentFilters = {};
  const dropped: string[] = [];
  const num = (v: string | string[] | undefined) => {
    const n = Number(list(v)[0]);
    return Number.isFinite(n) && list(v).length ? n : undefined;
  };
  for (const [key, value] of Object.entries(filters)) {
    switch (key) {
      case "stage":
        out.stage = list(value);
        break;
      case "country":
        out.country = list(value);
        break;
      case "tags":
        if (entity === "contact") out.tags = list(value);
        else dropped.push(key);
        break;
      case "emailStatus":
        if (entity === "contact") out.emailStatus = list(value);
        else dropped.push(key);
        break;
      case "seniority":
        if (entity === "contact") out.seniority = list(value);
        else dropped.push(key);
        break;
      case "titles":
        if (entity === "contact") out.title = list(value).join(", ");
        else dropped.push(key);
        break;
      case "industry":
        if (entity === "company") out.industry = list(value);
        else dropped.push(key);
        break;
      case "listId":
        out.listId = list(value)[0];
        if (list(value).length > 1) dropped.push(key);
        break;
      case "ownerId":
        out.ownerId = list(value)[0];
        if (list(value).length > 1) dropped.push(key);
        break;
      case "employeesMin":
        if (entity === "company") out.employeesMin = num(value);
        else dropped.push(key);
        break;
      case "employeesMax":
        if (entity === "company") out.employeesMax = num(value);
        else dropped.push(key);
        break;
      default:
        dropped.push(key);
    }
  }
  return { filters: out, dropped };
}
