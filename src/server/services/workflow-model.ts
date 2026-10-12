import "server-only";

import { and, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { TASK_PRIORITIES, TASK_TYPES } from "@/lib/pipeline-constants";
import { COMPANY_STAGES, CONTACT_STAGES, EMAIL_STATUSES, SENIORITIES } from "@/lib/records-vocabulary";
import {
  AVAILABLE_TRIGGER_EVENTS,
  BLOCK_TYPES,
  type BlockType,
  BRANCHING_BLOCKS,
  branchKeys,
  CONDITION_OPS,
  type EnrollmentFilters,
  TRIGGER_EVENTS,
  WEEKDAYS,
  type WorkflowBlock,
  type WorkflowCondition,
  type WorkflowSchedule,
  type WorkflowTarget,
} from "@/lib/workflows";
import { classifyIp, isIpLiteral } from "@/server/crawler/ip";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { HttpError } from "@/server/http/errors";

import { inList } from "./records";

export type Issue = { path: string; message: string };

export const MAX_BLOCKS = 100;
export const MAX_DEPTH = 6;

/* -------------------------------------------------------------------------- */
/* Structural schemas                                                         */
/* -------------------------------------------------------------------------- */

export const blockSchema: z.ZodType<WorkflowBlock> = z.lazy(() =>
  z
    .object({
      id: z.string().trim().min(1).max(40),
      type: z.enum(BLOCK_TYPES),
      config: z.record(z.string(), z.unknown()).default({}),
      branches: z.record(z.string().max(40), z.array(blockSchema).max(MAX_BLOCKS)).optional(),
    })
    .strict(),
);

export const blocksSchema = z.array(blockSchema).max(MAX_BLOCKS);

const optionalId = z.string().trim().min(1).max(64).optional();

export const enrollmentFiltersSchema = z
  .object({
    stage: z.array(z.string().max(40)).max(20).optional(),
    emailStatus: z.array(z.enum(EMAIL_STATUSES)).max(10).optional(),
    title: z.string().trim().max(200).optional(),
    country: z.array(z.string().trim().max(100)).max(50).optional(),
    seniority: z.array(z.enum(SENIORITIES)).max(20).optional(),
    tags: z.array(z.string().trim().max(50)).max(50).optional(),
    industry: z.array(z.string().trim().max(100)).max(50).optional(),
    listId: optionalId,
    ownerId: optionalId,
    employeesMin: z.number().int().min(0).max(10_000_000).optional(),
    employeesMax: z.number().int().min(0).max(10_000_000).optional(),
    pipelineId: optionalId,
    stageIds: z.array(z.string().max(64)).max(30).optional(),
    amountMin: z.number().int().min(0).optional(),
  })
  .strict();

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time, e.g. 09:00.");

export const scheduleSchema = z
  .object({
    at: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "Use an ISO date and time.")
      .optional(),
    weekly: z
      .object({ days: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day.").max(7), time: timeOfDay })
      .strict()
      .optional(),
    timezone: z
      .string()
      .max(64)
      .default("UTC")
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Unknown time zone."),
  })
  .strict()
  .refine((s) => Boolean(s.at) !== Boolean(s.weekly), { message: "Choose a date or a weekly schedule." });

/** Extra workflow settings, kept inside the `schedule` JSON column. */
export interface WorkflowSettings {
  description: string;
  allowReenroll: boolean;
}

export interface StoredSchedule extends Partial<WorkflowSchedule> {
  settings?: Partial<WorkflowSettings>;
}

export function readSettings(stored: Record<string, unknown> | null): WorkflowSettings {
  const s = (stored as StoredSchedule | null)?.settings ?? {};
  return { description: s.description ?? "", allowReenroll: s.allowReenroll ?? true };
}

export function readSchedule(stored: Record<string, unknown> | null): WorkflowSchedule | null {
  const s = stored as StoredSchedule | null;
  if (!s || (!s.at && !s.weekly)) return null;
  return { ...(s.at ? { at: s.at } : {}), ...(s.weekly ? { weekly: s.weekly } : {}), timezone: s.timezone ?? "UTC" };
}

/* -------------------------------------------------------------------------- */
/* Webhook URLs                                                               */
/* -------------------------------------------------------------------------- */

export function allowPrivateHosts(): boolean {
  return env().CRAWLER_ALLOW_PRIVATE_HOSTS;
}

function isPrivateHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isIpLiteral(host) && classifyIp(host) !== "public";
}

/** Why a webhook URL is refused, or null. https only; http only for private hosts in local setups. */
export function webhookUrlProblem(raw: string, allowPrivate = allowPrivateHosts()): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL starting with https://.";
  }
  if (url.username || url.password) return "Don't put credentials in the URL. Use the signing secret instead.";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Webhooks must use https://.";
  const privateHost = isPrivateHost(url);
  if (privateHost && !allowPrivate) return "Webhooks can't call private or internal addresses.";
  if (url.protocol === "http:" && !(allowPrivate && privateHost)) return "Webhooks must use https://.";
  // Hostnames are resolved and checked again at send time (guarded lookup), so DNS can't point them inward.
  return null;
}

/* -------------------------------------------------------------------------- */
/* Block validation                                                           */
/* -------------------------------------------------------------------------- */

const conditionSchema = z
  .object({
    field: z.string().min(1).max(64),
    op: z.enum(CONDITION_OPS),
    value: z.union([z.string().max(500), z.number(), z.null()]).optional(),
  })
  .strict();
const conditionsSchema = z.array(conditionSchema).max(10);
const matchSchema = z.enum(["all", "any"]).default("all");

const configSchemas: Record<BlockType, z.ZodTypeAny> = {
  branch_if: z.object({ match: matchSchema, conditions: conditionsSchema.default([]) }).strict(),
  split_multi: z
    .object({
      cases: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-z0-9_]{1,20}$/),
              label: z.string().max(60).optional(),
              match: matchSchema,
              conditions: conditionsSchema.default([]),
            })
            .strict(),
        )
        .min(1)
        .max(5),
    })
    .strict(),
  split_traffic: z
    .object({
      splits: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-z0-9_]{1,20}$/),
              label: z.string().max(60).optional(),
              percent: z.number().int().min(0).max(100),
            })
            .strict(),
        )
        .min(2)
        .max(5)
        .refine((s) => s.reduce((n, x) => n + x.percent, 0) === 100, "Percentages must add up to 100."),
    })
    .strict(),
  delay: z
    .object({ amount: z.number().int().min(1).max(10_000), unit: z.enum(["minutes", "hours", "days"]) })
    .strict()
    .refine((d) => delayMs(d) <= 365 * 86_400_000, "Delays can be at most a year."),
  exit: z.object({}).strict(),
  research_ai: z.object({ prompt: z.string().max(2000).optional() }).strict(),
  qualify_ai: z.object({ prompt: z.string().max(2000).optional() }).strict(),
  add_to_sequence: z.object({ sequenceId: optionalId }).strict(),
  remove_from_sequence: z.object({ sequenceId: optionalId }).strict(),
  add_to_list: z.object({ listId: optionalId }).strict(),
  remove_from_list: z.object({ listId: optionalId }).strict(),
  create_deal: z
    .object({
      name: z.string().max(200).optional(),
      pipelineId: optionalId,
      stageId: optionalId,
      amount: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
    })
    .strict(),
  update_deal_stage: z.object({ stageId: optionalId }).strict(),
  enrich: z.object({}).strict(),
  create_task: z
    .object({
      title: z.string().max(200).optional(),
      taskType: z.enum(TASK_TYPES).default("action_item"),
      priority: z.enum(TASK_PRIORITIES).default("medium"),
      dueInDays: z.number().int().min(0).max(365).default(1),
      assignee: z.string().max(64).default("owner"),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  update_record: z
    .object({
      field: z.enum(["stage", "owner", "customField"]),
      value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
      customFieldKey: z.string().max(64).optional(),
    })
    .strict(),
  notify: z
    .object({
      recipients: z.union([z.enum(["owner", "creator"]), z.array(z.string().max(64)).min(1).max(20)]).default("owner"),
      message: z.string().max(500).optional(),
    })
    .strict(),
  webhook: z
    .object({
      url: z.string().max(2000).optional(),
      secret: z.string().max(200).optional(),
    })
    .strict(),
};

export function delayMs(d: { amount: number; unit: "minutes" | "hours" | "days" }): number {
  const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
  return d.amount * UNIT_MS[d.unit];
}

interface ValidateOptions {
  target: WorkflowTarget;
  /** Launch requires every block to be complete; saving a draft doesn't. */
  forLaunch: boolean;
  /** Secrets already stored for webhook blocks (by block id). */
  storedSecrets?: Map<string, string>;
}

function walk(
  blocks: WorkflowBlock[],
  path: string,
  depth: number,
  seen: Set<string>,
  issues: Issue[],
  opts: ValidateOptions,
): void {
  if (depth > MAX_DEPTH) {
    issues.push({ path, message: `Nest branches at most ${MAX_DEPTH} levels deep.` });
    return;
  }
  blocks.forEach((block, index) => {
    const at = `${path}.${index}`;
    if (seen.has(block.id)) issues.push({ path: `${at}.id`, message: "Block ids must be unique." });
    seen.add(block.id);
    const parsed = configSchemas[block.type].safeParse(block.config ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: [at, "config", ...issue.path].join("."), message: issue.message });
      }
      return;
    }
    block.config = parsed.data as Record<string, unknown>;
    const last = index === blocks.length - 1;
    const branching = BRANCHING_BLOCKS.includes(block.type);
    if ((branching || block.type === "exit") && !last) {
      issues.push({
        path: at,
        message: branching
          ? "Nothing can follow a branch. Add blocks inside its paths."
          : "Exit must be the last block.",
      });
    }
    if (branching) {
      const expected = branchKeys(block).map((b) => b.key);
      const given = Object.keys(block.branches ?? {});
      if (new Set(expected).size !== expected.length)
        issues.push({ path: `${at}.config`, message: "Path keys must be unique." });
      if (expected.length !== given.length || expected.some((k) => !given.includes(k))) {
        issues.push({ path: `${at}.branches`, message: `Give this block the paths ${expected.join(", ")}.` });
      }
      for (const [key, child] of Object.entries(block.branches ?? {})) {
        walk(child, `${at}.branches.${key}`, depth + 1, seen, issues, opts);
      }
    } else if (block.branches && Object.keys(block.branches).length) {
      issues.push({ path: `${at}.branches`, message: "Only branch blocks have paths." });
    }
    checkConfig(block, at, issues, opts);
  });
}

function checkConfig(block: WorkflowBlock, at: string, issues: Issue[], opts: ValidateOptions): void {
  const c = block.config;
  const need = (field: string, message: string) => {
    if (opts.forLaunch && (c[field] === undefined || c[field] === null || c[field] === "")) {
      issues.push({ path: `${at}.config.${field}`, message });
    }
  };
  switch (block.type) {
    case "branch_if":
      if (opts.forLaunch && !(c.conditions as unknown[]).length) {
        issues.push({ path: `${at}.config.conditions`, message: "Add at least one condition." });
      }
      break;
    case "split_multi":
      if (opts.forLaunch) {
        (c.cases as { conditions: unknown[] }[]).forEach((cs, i) => {
          if (!cs.conditions.length)
            issues.push({ path: `${at}.config.cases.${i}`, message: "Give every path a condition." });
        });
      }
      break;
    case "add_to_list":
    case "remove_from_list":
      need("listId", "Choose a list.");
      break;
    case "add_to_sequence":
      need("sequenceId", "Choose a sequence.");
      break;
    case "update_deal_stage":
      need("stageId", "Choose a stage.");
      if (opts.forLaunch && opts.target !== "deal") {
        issues.push({ path: at, message: "Moving a deal stage needs a workflow that targets deals." });
      }
      break;
    case "create_task":
      need("title", "Give the task a title.");
      break;
    case "notify":
      need("message", "Write the notification.");
      break;
    case "update_record": {
      if (opts.forLaunch && (c.value === undefined || c.value === "")) {
        issues.push({ path: `${at}.config.value`, message: "Choose the new value." });
      }
      if (c.field === "stage" && c.value) {
        const STAGE_KEYS: Record<WorkflowTarget, readonly string[]> = {
          contact: CONTACT_STAGES,
          company: COMPANY_STAGES,
          deal: [],
        };
        const keys = STAGE_KEYS[opts.target];
        if (!keys.includes(String(c.value))) {
          issues.push({
            path: `${at}.config.value`,
            message: opts.target === "deal" ? "Use “Move deal stage” for deals." : "Pick one of the stages.",
          });
        }
      }
      if (c.field === "customField") need("customFieldKey", "Choose the field.");
      break;
    }
    case "enrich":
      if (opts.forLaunch && opts.target === "deal")
        issues.push({ path: at, message: "Enrichment works on people and companies." });
      break;
    case "webhook": {
      need("url", "Enter the URL to call.");
      if (typeof c.url === "string" && c.url) {
        const problem = webhookUrlProblem(c.url);
        if (problem) issues.push({ path: `${at}.config.url`, message: problem });
      }
      const given = typeof c.secret === "string" && c.secret ? c.secret : undefined;
      const secret = given ?? opts.storedSecrets?.get(block.id);
      if (secret !== undefined && secret.length < 16) {
        issues.push({ path: `${at}.config.secret`, message: "Use a signing secret of at least 16 characters." });
      }
      if (opts.forLaunch && !secret) issues.push({ path: `${at}.config.secret`, message: "Set a signing secret." });
      break;
    }
    default:
      break;
  }
}

/** Problems in a block tree (empty when fine). Fills in config defaults as it goes. */
export function blockIssues(blocks: WorkflowBlock[], opts: ValidateOptions): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  walk(blocks, "blocks", 1, seen, issues, opts);
  if (seen.size > MAX_BLOCKS) issues.push({ path: "blocks", message: `Use at most ${MAX_BLOCKS} blocks.` });
  return issues;
}

/** Validate a block tree. Throws 422 with one entry per problem. */
export function validateBlocks(blocks: WorkflowBlock[], opts: ValidateOptions): void {
  const issues = blockIssues(blocks, opts);
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);
}

export function validTriggerEvent(event: string, target: WorkflowTarget): string | null {
  const info = TRIGGER_EVENTS.find((e) => e.id === event);
  if (!info) return "Unknown trigger event.";
  if (!AVAILABLE_TRIGGER_EVENTS.includes(event)) return "This trigger isn't available yet.";
  if (!info.targets.includes(target)) return "This event can't enroll that kind of record.";
  return null;
}

/** Visit every block in the tree. */
export function eachBlock(blocks: WorkflowBlock[], visit: (block: WorkflowBlock) => void): void {
  for (const b of blocks) {
    visit(b);
    for (const child of Object.values(b.branches ?? {})) eachBlock(child, visit);
  }
}

/** Copy of the tree with webhook secrets removed (API output). */
export function redactBlocks(blocks: WorkflowBlock[]): WorkflowBlock[] {
  return blocks.map((b) => {
    const config = { ...b.config };
    if (b.type === "webhook") {
      config.hasSecret = Boolean(config.secret);
      delete config.secret;
    }
    return {
      ...b,
      config,
      ...(b.branches
        ? { branches: Object.fromEntries(Object.entries(b.branches).map(([k, v]) => [k, redactBlocks(v)])) }
        : {}),
    };
  });
}

export function storedSecrets(blocks: WorkflowBlock[]): Map<string, string> {
  const out = new Map<string, string>();
  eachBlock(blocks, (b) => {
    if (b.type === "webhook" && typeof b.config.secret === "string" && b.config.secret) out.set(b.id, b.config.secret);
  });
  return out;
}

/** Keep stored webhook secrets for blocks whose incoming config leaves the secret blank. */
export function mergeSecrets(blocks: WorkflowBlock[], secrets: Map<string, string>): WorkflowBlock[] {
  return blocks.map((b) => {
    const config = { ...b.config };
    delete config.hasSecret;
    if (b.type === "webhook" && !config.secret && secrets.has(b.id)) config.secret = secrets.get(b.id);
    if (b.type === "webhook" && config.secret === "") delete config.secret;
    return {
      ...b,
      config,
      ...(b.branches
        ? { branches: Object.fromEntries(Object.entries(b.branches).map(([k, v]) => [k, mergeSecrets(v, secrets)])) }
        : {}),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Enrollment filters → SQL                                                   */
/* -------------------------------------------------------------------------- */

const lowerIn = (column: SQL | typeof schema.contact.country, values: string[]) =>
  inArray(
    sql`lower(${column})`,
    values.map((v) => v.toLowerCase()),
  );

export function filterConditions(organizationId: string, target: WorkflowTarget, f: EnrollmentFilters): SQL[] {
  if (target === "contact") {
    const c = schema.contact;
    const out: SQL[] = [eq(c.organizationId, organizationId)];
    if (f.stage?.length) out.push(inArray(c.stage, f.stage as (typeof CONTACT_STAGES)[number][]));
    if (f.emailStatus?.length) out.push(inArray(c.emailStatus, f.emailStatus as (typeof EMAIL_STATUSES)[number][]));
    if (f.seniority?.length) out.push(inArray(c.seniority, f.seniority as (typeof SENIORITIES)[number][]));
    if (f.title) {
      const words = f.title
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
      const pattern = (w: string) => `%${w.replace(/[%_\\]/g, "\\$&")}%`;
      if (words.length) out.push(or(...words.map((w) => ilike(c.title, pattern(w)))) as SQL);
    }
    if (f.country?.length) out.push(lowerIn(c.country, f.country));
    if (f.tags?.length) {
      out.push(
        sql`${c.tags} && ARRAY[${sql.join(
          f.tags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]`,
      );
    }
    if (f.listId) out.push(inList(f.listId, c.id));
    if (f.ownerId) out.push(eq(c.ownerId, f.ownerId));
    return out;
  }
  if (target === "company") {
    const c = schema.company;
    const out: SQL[] = [eq(c.organizationId, organizationId)];
    if (f.stage?.length) out.push(inArray(c.stage, f.stage as (typeof COMPANY_STAGES)[number][]));
    if (f.industry?.length) out.push(lowerIn(sql`${c.industry}`, f.industry));
    if (f.country?.length) out.push(lowerIn(sql`${c.country}`, f.country));
    if (f.listId) out.push(inList(f.listId, c.id));
    if (f.ownerId) out.push(eq(c.ownerId, f.ownerId));
    if (f.employeesMin !== undefined) out.push(sql`${c.employeeCount} >= ${f.employeesMin}`);
    if (f.employeesMax !== undefined) out.push(sql`${c.employeeCount} <= ${f.employeesMax}`);
    return out;
  }
  const d = schema.deal;
  const out: SQL[] = [eq(d.organizationId, organizationId)];
  if (f.pipelineId) out.push(eq(d.pipelineId, f.pipelineId));
  if (f.stageIds?.length) out.push(inArray(d.stageId, f.stageIds));
  if (f.ownerId) out.push(eq(d.ownerId, f.ownerId));
  if (f.amountMin !== undefined) out.push(sql`${d.amount} >= ${f.amountMin}`);
  return out;
}

function targetTable(target: WorkflowTarget) {
  if (target === "company") return schema.company;
  if (target === "deal") return schema.deal;
  return schema.contact;
}

export async function countMatching(
  organizationId: string,
  target: WorkflowTarget,
  f: EnrollmentFilters,
): Promise<number> {
  const table = targetTable(target);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(...filterConditions(organizationId, target, f)));
  return row?.n ?? 0;
}

export async function matchingIds(
  organizationId: string,
  target: WorkflowTarget,
  f: EnrollmentFilters,
  limit: number,
): Promise<string[]> {
  const table = targetTable(target);
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(...filterConditions(organizationId, target, f)))
    .orderBy(table.createdAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function entityMatches(
  organizationId: string,
  target: WorkflowTarget,
  entityId: string,
  f: EnrollmentFilters,
): Promise<boolean> {
  const table = targetTable(target);
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), ...filterConditions(organizationId, target, f)))
    .limit(1);
  return Boolean(row);
}

/** References in filters must be inside the workspace (422 otherwise). */
export async function checkFilterRefs(organizationId: string, f: EnrollmentFilters): Promise<void> {
  const issues: Issue[] = [];
  if (f.listId) {
    const [row] = await db
      .select({ id: schema.list.id })
      .from(schema.list)
      .where(and(eq(schema.list.organizationId, organizationId), eq(schema.list.id, f.listId)))
      .limit(1);
    if (!row) issues.push({ path: "enrollmentFilters.listId", message: "List not found." });
  }
  if (f.ownerId) {
    const [row] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, f.ownerId)))
      .limit(1);
    if (!row)
      issues.push({ path: "enrollmentFilters.ownerId", message: "Pick someone who is a member of this workspace." });
  }
  if (f.pipelineId) {
    const [row] = await db
      .select({ id: schema.pipeline.id })
      .from(schema.pipeline)
      .where(and(eq(schema.pipeline.organizationId, organizationId), eq(schema.pipeline.id, f.pipelineId)))
      .limit(1);
    if (!row) issues.push({ path: "enrollmentFilters.pipelineId", message: "Pipeline not found." });
  }
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);
}

/* -------------------------------------------------------------------------- */
/* Entities and conditions                                                    */
/* -------------------------------------------------------------------------- */

export interface EntityContext {
  target: WorkflowTarget;
  id: string;
  name: string;
  fields: Record<string, unknown>;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ownerId: string | null;
}

export async function loadEntity(
  organizationId: string,
  target: WorkflowTarget,
  id: string,
): Promise<EntityContext | null> {
  if (target === "contact") {
    const c = schema.contact;
    const [row] = await db
      .select()
      .from(c)
      .where(and(eq(c.organizationId, organizationId), eq(c.id, id)))
      .limit(1);
    if (!row) return null;
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "Unnamed person";
    return {
      target,
      id,
      name,
      fields: { ...row, customFields: row.customFields },
      contactId: row.id,
      companyId: row.companyId,
      dealId: null,
      ownerId: row.ownerId,
    };
  }
  if (target === "company") {
    const c = schema.company;
    const [row] = await db
      .select()
      .from(c)
      .where(and(eq(c.organizationId, organizationId), eq(c.id, id)))
      .limit(1);
    if (!row) return null;
    return {
      target,
      id,
      name: row.name,
      fields: { ...row },
      contactId: null,
      companyId: row.id,
      dealId: null,
      ownerId: row.ownerId,
    };
  }
  const d = schema.deal;
  const [row] = await db
    .select({
      deal: d,
      stageName: schema.pipelineStage.name,
      stageType: schema.pipelineStage.type,
    })
    .from(d)
    .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, d.stageId))
    .where(and(eq(d.organizationId, organizationId), eq(d.id, id)))
    .limit(1);
  if (!row) return null;
  return {
    target,
    id,
    name: row.deal.name,
    fields: { ...row.deal, stageName: row.stageName, stageType: row.stageType },
    contactId: row.deal.contactId,
    companyId: row.deal.companyId,
    dealId: row.deal.id,
    ownerId: row.deal.ownerId,
  };
}

async function inListCheck(entityId: string, listId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.listMember.entityId })
    .from(schema.listMember)
    .where(and(eq(schema.listMember.listId, listId), eq(schema.listMember.entityId, entityId)))
    .limit(1);
  return Boolean(row);
}

export async function evaluateCondition(entity: EntityContext, cond: WorkflowCondition): Promise<boolean> {
  if (cond.field === "list") {
    if (!cond.value) return false;
    const member = await inListCheck(entity.id, String(cond.value));
    return cond.op === "not_in_list" ? !member : member;
  }
  const raw = cond.field.startsWith("custom:")
    ? (entity.fields.customFields as Record<string, unknown> | undefined)?.[cond.field.slice(7)]
    : entity.fields[cond.field];
  const empty = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
  if (cond.op === "is_empty") return empty;
  if (cond.op === "is_not_empty") return !empty;
  if (empty) return cond.op === "neq" || cond.op === "not_contains";
  const want = cond.value === null || cond.value === undefined ? "" : String(cond.value).toLowerCase();
  if (Array.isArray(raw)) {
    const items = raw.map((x) => String(x).toLowerCase());
    if (cond.op === "eq" || cond.op === "contains")
      return items.some((x) => (cond.op === "eq" ? x === want : x.includes(want)));
    if (cond.op === "neq" || cond.op === "not_contains")
      return !items.some((x) => (cond.op === "neq" ? x === want : x.includes(want)));
    return false;
  }
  if (cond.op === "gt" || cond.op === "lt") {
    const a = Number(raw);
    const b = Number(cond.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return cond.op === "gt" ? a > b : a < b;
  }
  const have = String(raw).toLowerCase();
  switch (cond.op) {
    case "eq":
      return have === want;
    case "neq":
      return have !== want;
    case "contains":
      return have.includes(want);
    case "not_contains":
      return !have.includes(want);
    default:
      return false;
  }
}

export async function evaluateAll(
  entity: EntityContext,
  conditions: WorkflowCondition[],
  match: "all" | "any",
): Promise<boolean> {
  if (!conditions.length) return true;
  for (const cond of conditions) {
    const ok = await evaluateCondition(entity, cond);
    if (match === "any" && ok) return true;
    if (match === "all" && !ok) return false;
  }
  return match === "all";
}
