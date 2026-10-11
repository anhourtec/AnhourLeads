import "server-only";

import { and, count, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  type EnrollmentFilters,
  makeBlock,
  type RunStatus,
  WORKFLOW_STATUSES,
  WORKFLOW_TARGETS,
  type WorkflowBlock,
  type WorkflowSchedule,
  type WorkflowStatus,
  type WorkflowTarget,
} from "@/lib/workflows";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import type { RunLogEntry } from "./workflow-engine";
import {
  blockIssues,
  blocksSchema,
  checkFilterRefs,
  countMatching,
  enrollmentFiltersSchema,
  loadEntity,
  mergeSecrets,
  readSchedule,
  readSettings,
  redactBlocks,
  type StoredSchedule,
  scheduleSchema,
  storedSecrets,
  validTriggerEvent,
} from "./workflow-model";
import { dryRun, processDue } from "./workflow-runner";

const { workflow, workflowRun } = schema;
type WorkflowRow = typeof workflow.$inferSelect;

export interface WorkflowDto {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  targetType: WorkflowTarget;
  triggerType: "event" | "schedule";
  triggerEvent: string | null;
  schedule: WorkflowSchedule | null;
  enrollmentFilters: EnrollmentFilters;
  blocks: WorkflowBlock[];
  allowReenroll: boolean;
  owner: { id: string; name: string } | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: { runs: number; active: number; completed: number; failed: number };
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const base = {
  name: z.string().trim().min(1, "Name the workflow.").max(120),
  description: z.string().trim().max(1000),
  targetType: z.enum(WORKFLOW_TARGETS),
  triggerType: z.enum(["event", "schedule"]),
  triggerEvent: z.string().trim().max(64).nullable(),
  schedule: scheduleSchema.nullable(),
  enrollmentFilters: enrollmentFiltersSchema,
  blocks: blocksSchema,
  allowReenroll: z.boolean(),
};

export const workflowCreateSchema = z
  .object({
    name: base.name.optional(),
    description: base.description.optional(),
    targetType: base.targetType.optional(),
    triggerType: base.triggerType.optional(),
    triggerEvent: base.triggerEvent.optional(),
    schedule: base.schedule.optional(),
    enrollmentFilters: base.enrollmentFilters.optional(),
    blocks: base.blocks.optional(),
    allowReenroll: base.allowReenroll.optional(),
    templateId: z.string().max(64).optional(),
  })
  .strict();

export const workflowUpdateSchema = z
  .object({
    name: base.name.optional(),
    description: base.description.optional(),
    targetType: base.targetType.optional(),
    triggerType: base.triggerType.optional(),
    triggerEvent: base.triggerEvent.optional(),
    schedule: base.schedule.optional(),
    enrollmentFilters: base.enrollmentFilters.optional(),
    blocks: base.blocks.optional(),
    allowReenroll: base.allowReenroll.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

export const workflowSearchSchema = z.object({
  status: z.enum(WORKFLOW_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
});

export const workflowTestSchema = z.object({ entityId: z.string().trim().min(1).max(64) }).strict();

export const enrollmentCountSchema = z
  .object({
    targetType: z.enum(WORKFLOW_TARGETS).default("contact"),
    enrollmentFilters: enrollmentFiltersSchema.default({}),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export interface TemplateBlock {
  type: WorkflowBlock["type"];
  config: Record<string, unknown>;
  branches?: Record<string, TemplateBlock[]>;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  kind: "linear" | "multi_branch";
  tags: string[];
  targetType: WorkflowTarget;
  triggerType: "event" | "schedule";
  triggerEvent: string | null;
  enrollmentFilters: EnrollmentFilters;
  /** Blocks with ids assigned at copy time. Lists and sequences are chosen after copying. */
  blocks: TemplateBlock[];
}

const T = (type: WorkflowBlock["type"], config: Record<string, unknown> = {}): TemplateBlock => {
  const made = makeBlock(type);
  return {
    type: made.type,
    config: { ...made.config, ...config },
    ...(made.branches ? { branches: Object.fromEntries(Object.keys(made.branches).map((k) => [k, []])) } : {}),
  };
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "icp-to-sequence",
    name: "Turn ideal customers into conversations",
    description: "When a person who fits your profile is saved, add them to a list and start a sequence.",
    kind: "linear",
    tags: ["Generate pipeline"],
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "contact_created",
    enrollmentFilters: { emailStatus: ["valid"] },
    blocks: [T("add_to_list"), T("add_to_sequence")],
  },
  {
    id: "new-hires",
    name: "Reach people who changed jobs",
    description: "When someone moves to the Changed job stage, assign a task to reconnect and start a sequence.",
    kind: "linear",
    tags: ["Generate pipeline"],
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "stage_changed",
    enrollmentFilters: { stage: ["changed_job"] },
    blocks: [
      T("create_task", { title: "Congratulate them on the new role", taskType: "linkedin_message", dueInDays: 1 }),
      T("add_to_sequence"),
    ],
  },
  {
    id: "replied-follow-up",
    name: "Follow up on replies",
    description: "When someone replies, assign their owner a task to qualify the reply and mark interest.",
    kind: "linear",
    tags: ["Engagement"],
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "email_replied",
    enrollmentFilters: {},
    blocks: [
      T("create_task", {
        title: "Read the reply and mark them interested if they are",
        priority: "high",
        dueInDays: 0,
      }),
    ],
  },
  {
    id: "bounce-cleanup",
    name: "Clean up bounced addresses",
    description: "When an email bounces, mark the person as bad data and stop all their sequences.",
    kind: "linear",
    tags: ["Data quality"],
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "email_bounced",
    enrollmentFilters: {},
    blocks: [
      T("update_record", { field: "stage", value: "bad_data" }),
      T("remove_from_sequence", { sequenceId: "all" }),
    ],
  },
  {
    id: "deal-won-notify",
    name: "Celebrate won deals",
    description: "When a deal reaches a won stage, notify its owner.",
    kind: "multi_branch",
    tags: ["Win deals"],
    targetType: "deal",
    triggerType: "event",
    triggerEvent: "deal_stage_changed",
    enrollmentFilters: {},
    blocks: [
      {
        ...T("branch_if", { match: "all", conditions: [{ field: "stageType", op: "eq", value: "won" }] }),
        branches: { yes: [T("notify", { recipients: "owner", message: "A deal was won" })], no: [] },
      },
    ],
  },
  {
    id: "interested-to-deal",
    name: "Open a deal for interested people",
    description: "When someone is marked interested, create a deal and a call task for their owner.",
    kind: "linear",
    tags: ["Win deals"],
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "marked_interested",
    enrollmentFilters: {},
    blocks: [
      T("create_deal"),
      T("create_task", { title: "Book a call", taskType: "call", priority: "high", dueInDays: 1 }),
    ],
  },
  {
    id: "weekly-enrich",
    name: "Keep new records enriched",
    description: "Every Monday morning, enrich people with unverified emails.",
    kind: "linear",
    tags: ["Data quality"],
    targetType: "contact",
    triggerType: "schedule",
    triggerEvent: null,
    enrollmentFilters: { emailStatus: ["unverified"] },
    blocks: [T("enrich")],
  },
  {
    id: "engaged-companies",
    name: "Split engaged companies by size",
    description:
      "Weekly: send large engaged companies to a list for your account executives and the rest to a sequence list.",
    kind: "multi_branch",
    tags: ["Generate pipeline"],
    targetType: "company",
    triggerType: "schedule",
    triggerEvent: null,
    enrollmentFilters: { stage: ["engaged"] },
    blocks: [
      {
        ...T("branch_if", { match: "all", conditions: [{ field: "employeeCount", op: "gt", value: 200 }] }),
        branches: { yes: [T("add_to_list")], no: [T("add_to_list")] },
      },
    ],
  },
  {
    id: "ab-test-sequences",
    name: "Test two sequences against each other",
    description: "Split new people evenly between two sequences to compare results.",
    kind: "multi_branch",
    tags: ["Engagement"],
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "contact_added_to_list",
    enrollmentFilters: {},
    blocks: [
      {
        ...T("split_traffic"),
        branches: { a: [T("add_to_sequence")], b: [T("add_to_sequence")] },
      },
    ],
  },
];

function withIds(blocks: TemplateBlock[]): WorkflowBlock[] {
  return blocks.map(
    (b): WorkflowBlock => ({
      id: makeBlock(b.type).id,
      type: b.type,
      config: { ...b.config },
      ...(b.branches
        ? { branches: Object.fromEntries(Object.entries(b.branches).map(([k, v]) => [k, withIds(v)])) }
        : {}),
    }),
  );
}

export function listTemplates() {
  return WORKFLOW_TEMPLATES;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

async function statsFor(ids: string[]) {
  if (!ids.length) return new Map<string, WorkflowDto["stats"]>();
  const rows = await db
    .select({
      workflowId: workflowRun.workflowId,
      runs: count(),
      active: sql<number>`count(*) filter (where ${workflowRun.status} in ('running', 'waiting'))::int`,
      completed: sql<number>`count(*) filter (where ${workflowRun.status} in ('completed', 'exited'))::int`,
      failed: sql<number>`count(*) filter (where ${workflowRun.status} = 'failed')::int`,
    })
    .from(workflowRun)
    .where(inArray(workflowRun.workflowId, ids))
    .groupBy(workflowRun.workflowId);
  return new Map(
    rows.map((r) => [r.workflowId, { runs: r.runs, active: r.active, completed: r.completed, failed: r.failed }]),
  );
}

async function toDtos(rows: WorkflowRow[]): Promise<WorkflowDto[]> {
  const stats = await statsFor(rows.map((r) => r.id));
  const ownerIds = [...new Set(rows.flatMap((r) => (r.createdById ? [r.createdById] : [])))];
  const owners = ownerIds.length
    ? await db
        .select({ id: schema.user.id, name: schema.user.name })
        .from(schema.user)
        .where(inArray(schema.user.id, ownerIds))
    : [];
  return rows.map((r) => {
    const settings = readSettings(r.schedule);
    const owner = owners.find((o) => o.id === r.createdById) ?? null;
    return {
      id: r.id,
      name: r.name,
      description: settings.description,
      status: r.status,
      targetType: r.targetType,
      triggerType: r.triggerType,
      triggerEvent: r.triggerEvent,
      schedule: readSchedule(r.schedule),
      enrollmentFilters: r.enrollmentFilters as EnrollmentFilters,
      blocks: redactBlocks(r.blocks as WorkflowBlock[]),
      allowReenroll: settings.allowReenroll,
      owner,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      stats: stats.get(r.id) ?? { runs: 0, active: 0, completed: 0, failed: 0 },
    };
  });
}

export async function searchWorkflows(actor: Actor, input: z.infer<typeof workflowSearchSchema>) {
  const rows = await db
    .select()
    .from(workflow)
    .where(
      and(
        eq(workflow.organizationId, actor.organizationId),
        input.status ? eq(workflow.status, input.status) : ne(workflow.status, "archived"),
        input.q ? sql`${workflow.name} ilike ${`%${input.q.replace(/[%_\\]/g, "\\$&")}%`}` : undefined,
      ),
    )
    .orderBy(desc(workflow.updatedAt))
    .limit(200);
  return toDtos(rows);
}

async function findRow(actor: Pick<Actor, "organizationId">, id: string): Promise<WorkflowRow> {
  const [row] = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.organizationId, actor.organizationId), eq(workflow.id, id)))
    .limit(1);
  if (!row) throw notFound("Workflow not found.");
  return row;
}

export async function getWorkflow(actor: Pick<Actor, "organizationId">, id: string): Promise<WorkflowDto> {
  const [dto] = await toDtos([await findRow(actor, id)]);
  return dto;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

function defaultName(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  const time = now.toISOString().slice(11, 16);
  return `New workflow · ${date}, ${time}`;
}

interface Draft {
  name: string;
  targetType: WorkflowTarget;
  triggerType: "event" | "schedule";
  triggerEvent: string | null;
  schedule: StoredSchedule;
  enrollmentFilters: EnrollmentFilters;
  blocks: WorkflowBlock[];
}

async function checkDraft(actor: Actor, draft: Draft, forLaunch: boolean, secrets: Map<string, string>) {
  const issues: { path: string; message: string }[] = [];
  if (draft.triggerType === "event" && draft.triggerEvent) {
    const problem = validTriggerEvent(draft.triggerEvent, draft.targetType);
    if (problem) issues.push({ path: "triggerEvent", message: problem });
  }
  if (forLaunch) {
    if (draft.triggerType === "event" && !draft.triggerEvent)
      issues.push({ path: "triggerEvent", message: "Choose a trigger event." });
    if (draft.triggerType === "schedule" && !readSchedule(draft.schedule as Record<string, unknown>)) {
      issues.push({ path: "schedule", message: "Choose when the workflow runs." });
    }
    if (!draft.blocks.length) issues.push({ path: "blocks", message: "Add at least one block." });
  }
  issues.push(...blockIssues(draft.blocks, { target: draft.targetType, forLaunch, storedSecrets: secrets }));
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);
  await checkFilterRefs(actor.organizationId, draft.enrollmentFilters);
  if (forLaunch) await checkBlockRefs(actor, draft.blocks);
}

/** Lists, sequences, pipelines, stages and people referenced by blocks must be in the workspace. */
async function checkBlockRefs(actor: Actor, blocks: WorkflowBlock[]): Promise<void> {
  const issues: { path: string; message: string }[] = [];
  const visit = async (list: WorkflowBlock[], path: string) => {
    for (const [i, b] of list.entries()) {
      const at = `${path}.${i}.config`;
      const c = b.config;
      const exists = async (
        table: typeof schema.list | typeof schema.sequence | typeof schema.pipeline,
        id: unknown,
      ) => {
        if (typeof id !== "string") return true;
        const [row] = await db
          .select({ id: table.id })
          .from(table)
          .where(and(eq(table.organizationId, actor.organizationId), eq(table.id, id)))
          .limit(1);
        return Boolean(row);
      };
      if ((b.type === "add_to_list" || b.type === "remove_from_list") && !(await exists(schema.list, c.listId))) {
        issues.push({ path: `${at}.listId`, message: "List not found." });
      }
      if (b.type === "add_to_sequence" && !(await exists(schema.sequence, c.sequenceId))) {
        issues.push({ path: `${at}.sequenceId`, message: "Sequence not found." });
      }
      if (
        b.type === "remove_from_sequence" &&
        c.sequenceId !== "all" &&
        !(await exists(schema.sequence, c.sequenceId))
      ) {
        issues.push({ path: `${at}.sequenceId`, message: "Sequence not found." });
      }
      if (b.type === "create_deal" && !(await exists(schema.pipeline, c.pipelineId))) {
        issues.push({ path: `${at}.pipelineId`, message: "Pipeline not found." });
      }
      if ((b.type === "update_deal_stage" || b.type === "create_deal") && typeof c.stageId === "string") {
        const [row] = await db
          .select({ id: schema.pipelineStage.id })
          .from(schema.pipelineStage)
          .innerJoin(schema.pipeline, eq(schema.pipeline.id, schema.pipelineStage.pipelineId))
          .where(and(eq(schema.pipeline.organizationId, actor.organizationId), eq(schema.pipelineStage.id, c.stageId)))
          .limit(1);
        if (!row) issues.push({ path: `${at}.stageId`, message: "Stage not found." });
      }
      const people = [
        ...(b.type === "notify" && Array.isArray(c.recipients) ? (c.recipients as string[]) : []),
        ...(b.type === "create_task" && typeof c.assignee === "string" && !["owner", "creator"].includes(c.assignee)
          ? [c.assignee]
          : []),
        ...(b.type === "update_record" && c.field === "owner" && typeof c.value === "string" ? [c.value] : []),
      ];
      if (people.length) {
        const rows = await db
          .select({ userId: schema.member.userId })
          .from(schema.member)
          .where(and(eq(schema.member.organizationId, actor.organizationId), inArray(schema.member.userId, people)));
        if (rows.length !== new Set(people).size) issues.push({ path: at, message: "Pick members of this workspace." });
      }
      for (const [key, child] of Object.entries(b.branches ?? {})) await visit(child, `${path}.${i}.branches.${key}`);
    }
  };
  await visit(blocks, "blocks");
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);
}

function storedScheduleOf(
  current: StoredSchedule | null,
  input: { schedule?: WorkflowSchedule | null; description?: string; allowReenroll?: boolean },
): StoredSchedule {
  const prev = current ?? {};
  const timing =
    input.schedule === undefined
      ? { at: prev.at, weekly: prev.weekly, timezone: prev.timezone }
      : (input.schedule ?? {});
  const settings = {
    description: input.description ?? prev.settings?.description ?? "",
    allowReenroll: input.allowReenroll ?? prev.settings?.allowReenroll ?? true,
  };
  return {
    ...(timing.at ? { at: timing.at } : {}),
    ...(timing.weekly ? { weekly: timing.weekly } : {}),
    ...(timing.at || timing.weekly ? { timezone: timing.timezone ?? "UTC" } : {}),
    settings,
  };
}

function initialBlocks(given: WorkflowBlock[] | undefined, template: WorkflowTemplate | undefined): WorkflowBlock[] {
  if (given) return mergeSecrets(given, new Map());
  return template ? withIds(template.blocks) : [];
}

export async function createWorkflow(actor: Actor, input: z.infer<typeof workflowCreateSchema>): Promise<WorkflowDto> {
  const template = input.templateId ? WORKFLOW_TEMPLATES.find((t) => t.id === input.templateId) : undefined;
  if (input.templateId && !template) {
    throw new HttpError(422, "Some fields are invalid.", [{ path: "templateId", message: "Template not found." }]);
  }
  const draft: Draft = {
    name: input.name ?? template?.name ?? defaultName(),
    targetType: input.targetType ?? template?.targetType ?? "contact",
    triggerType: input.triggerType ?? template?.triggerType ?? "event",
    triggerEvent: input.triggerEvent ?? template?.triggerEvent ?? null,
    schedule: storedScheduleOf(null, {
      schedule:
        input.schedule ??
        (template?.triggerType === "schedule" ? { weekly: { days: ["mon"], time: "09:00" }, timezone: "UTC" } : null),
      description: input.description ?? template?.description ?? "",
      allowReenroll: input.allowReenroll,
    }),
    enrollmentFilters: input.enrollmentFilters ?? template?.enrollmentFilters ?? {},
    blocks: initialBlocks(input.blocks, template),
  };
  await checkDraft(actor, draft, false, new Map());
  const [row] = await db
    .insert(workflow)
    .values({
      organizationId: actor.organizationId,
      name: draft.name,
      status: "draft",
      targetType: draft.targetType,
      triggerType: draft.triggerType,
      triggerEvent: draft.triggerEvent,
      schedule: draft.schedule as Record<string, unknown>,
      enrollmentFilters: draft.enrollmentFilters as Record<string, unknown>,
      blocks: draft.blocks,
      createdById: actor.userId,
    })
    .returning({ id: workflow.id });
  await audit(actor, "workflow.create", "workflow", row.id, { templateId: input.templateId ?? null });
  return getWorkflow(actor, row.id);
}

export async function updateWorkflow(
  actor: Actor,
  id: string,
  input: z.infer<typeof workflowUpdateSchema>,
): Promise<WorkflowDto> {
  const row = await findRow(actor, id);
  if (row.status === "archived") throw new HttpError(422, "Archived workflows can't be edited.");
  const secrets = storedSecrets(row.blocks as WorkflowBlock[]);
  const draft: Draft = {
    name: input.name ?? row.name,
    targetType: input.targetType ?? row.targetType,
    triggerType: input.triggerType ?? row.triggerType,
    triggerEvent: input.triggerEvent === undefined ? row.triggerEvent : input.triggerEvent,
    schedule: storedScheduleOf(row.schedule as StoredSchedule | null, input),
    enrollmentFilters: input.enrollmentFilters ?? (row.enrollmentFilters as EnrollmentFilters),
    blocks: input.blocks ? mergeSecrets(input.blocks, secrets) : (row.blocks as WorkflowBlock[]),
  };
  // An active workflow must stay launchable.
  await checkDraft(actor, draft, row.status === "active", secrets);
  await db
    .update(workflow)
    .set({
      name: draft.name,
      targetType: draft.targetType,
      triggerType: draft.triggerType,
      triggerEvent: draft.triggerEvent,
      schedule: draft.schedule as Record<string, unknown>,
      enrollmentFilters: draft.enrollmentFilters as Record<string, unknown>,
      blocks: draft.blocks,
    })
    .where(eq(workflow.id, id));
  await audit(actor, "workflow.update", "workflow", id, {
    fields: Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k),
  });
  return getWorkflow(actor, id);
}

export async function deleteWorkflow(actor: Actor, id: string): Promise<void> {
  await findRow(actor, id);
  await db.delete(workflow).where(eq(workflow.id, id));
  await audit(actor, "workflow.delete", "workflow", id);
}

/**
 * Launch: validate everything, then run as the launching member from now on (their permissions are
 * re-checked on every run). Paused runs continue.
 */
export async function launchWorkflow(actor: Actor, id: string): Promise<WorkflowDto> {
  const row = await findRow(actor, id);
  if (row.status === "archived") throw new HttpError(422, "Archived workflows can't be launched.");
  if (!actor.userId) throw new HttpError(422, "Launch workflows as a member, not with an API key that has no owner.");
  const secrets = storedSecrets(row.blocks as WorkflowBlock[]);
  await checkDraft(
    actor,
    {
      name: row.name,
      targetType: row.targetType,
      triggerType: row.triggerType,
      triggerEvent: row.triggerEvent,
      schedule: (row.schedule ?? {}) as StoredSchedule,
      enrollmentFilters: row.enrollmentFilters as EnrollmentFilters,
      blocks: row.blocks as WorkflowBlock[],
    },
    true,
    secrets,
  );
  const schedule = readSchedule(row.schedule);
  await db
    .update(workflow)
    .set({
      status: "active",
      createdById: actor.userId,
      // Weekly schedules start with the next occurrence, not the one that already passed.
      ...(row.triggerType === "schedule" && schedule?.weekly ? { lastRunAt: new Date() } : {}),
    })
    .where(eq(workflow.id, id));
  await audit(actor, "workflow.launch", "workflow", id);
  return getWorkflow(actor, id);
}

export async function pauseWorkflow(actor: Actor, id: string): Promise<WorkflowDto> {
  const row = await findRow(actor, id);
  if (row.status !== "active") throw new HttpError(422, "Only active workflows can be paused.");
  await db.update(workflow).set({ status: "paused" }).where(eq(workflow.id, id));
  await audit(actor, "workflow.pause", "workflow", id);
  return getWorkflow(actor, id);
}

export async function archiveWorkflow(actor: Actor, id: string): Promise<WorkflowDto> {
  await findRow(actor, id);
  await db.transaction(async (tx) => {
    await tx.update(workflow).set({ status: "archived" }).where(eq(workflow.id, id));
    await tx
      .update(workflowRun)
      .set({ status: "exited", finishedAt: new Date(), resumeAt: null })
      .where(and(eq(workflowRun.workflowId, id), inArray(workflowRun.status, ["running", "waiting"])));
  });
  await audit(actor, "workflow.archive", "workflow", id);
  return getWorkflow(actor, id);
}

/* -------------------------------------------------------------------------- */
/* Runs, tests, counts                                                        */
/* -------------------------------------------------------------------------- */

export interface RunDto {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string;
  status: RunStatus;
  resumeAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  log: RunLogEntry[];
}

async function entityNames(organizationId: string, target: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  if (target === "company") {
    const rows = await db
      .select({ id: schema.company.id, name: schema.company.name })
      .from(schema.company)
      .where(and(eq(schema.company.organizationId, organizationId), inArray(schema.company.id, ids)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
  if (target === "deal") {
    const rows = await db
      .select({ id: schema.deal.id, name: schema.deal.name })
      .from(schema.deal)
      .where(and(eq(schema.deal.organizationId, organizationId), inArray(schema.deal.id, ids)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
  const rows = await db
    .select({
      id: schema.contact.id,
      first: schema.contact.firstName,
      last: schema.contact.lastName,
      email: schema.contact.email,
    })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, organizationId), inArray(schema.contact.id, ids)));
  return new Map(rows.map((r) => [r.id, [r.first, r.last].filter(Boolean).join(" ") || r.email || "Unnamed person"]));
}

export async function listRuns(actor: Actor, id: string, page: Page) {
  const row = await findRow(actor, id);
  const where = eq(workflowRun.workflowId, row.id);
  const [runs, [{ total }]] = await Promise.all([
    db
      .select()
      .from(workflowRun)
      .where(where)
      .orderBy(desc(workflowRun.startedAt))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ total: count() }).from(workflowRun).where(where),
  ]);
  const names = await entityNames(actor.organizationId, row.targetType, [...new Set(runs.map((r) => r.entityId))]);
  return {
    runs: runs.map(
      (r): RunDto => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        entityName: names.get(r.entityId) ?? "Deleted record",
        status: r.status,
        resumeAt: r.resumeAt?.toISOString() ?? null,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        log: r.log as RunLogEntry[],
      }),
    ),
    total,
  };
}

export async function testWorkflow(actor: Actor, id: string, input: z.infer<typeof workflowTestSchema>) {
  const row = await findRow(actor, id);
  const entity = await loadEntity(actor.organizationId, row.targetType, input.entityId);
  if (!entity) {
    throw new HttpError(422, "Some fields are invalid.", [
      { path: "entityId", message: "Record not found in this workspace." },
    ]);
  }
  const { entityMatches } = await import("./workflow-model");
  const matches = await entityMatches(
    actor.organizationId,
    row.targetType,
    entity.id,
    row.enrollmentFilters as EnrollmentFilters,
  );
  return {
    entity: { id: entity.id, name: entity.name, type: entity.target },
    matchesFilters: matches,
    path: await dryRun(row, entity),
  };
}

export async function enrollmentCount(actor: Actor, input: z.infer<typeof enrollmentCountSchema>) {
  await checkFilterRefs(actor.organizationId, input.enrollmentFilters);
  return { count: await countMatching(actor.organizationId, input.targetType, input.enrollmentFilters) };
}

/** Process due scheduled enrollments and waiting runs for one workflow now. */
export async function runDue(actor: Actor, id: string) {
  const row = await findRow(actor, id);
  if (row.status !== "active") throw new HttpError(422, "Launch the workflow first.");
  return processDue(row.id);
}

export async function workflowSummary(actor: Pick<Actor, "organizationId">) {
  const [row] = await db
    .select({ n: count(), last: max(workflow.lastRunAt) })
    .from(workflow)
    .where(and(eq(workflow.organizationId, actor.organizationId), eq(workflow.status, "active")));
  return { active: row?.n ?? 0, lastRunAt: row?.last?.toISOString() ?? null };
}
