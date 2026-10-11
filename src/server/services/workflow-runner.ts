import "server-only";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { can, isRole, type Permission, type Role } from "@/lib/rbac/permissions";
import {
  BLOCK_INFO,
  type EnrollmentFilters,
  WEEKDAYS,
  type WorkflowBlock,
  type WorkflowCondition,
  type WorkflowTarget,
} from "@/lib/workflows";
import type { Actor } from "@/server/auth/actor";
import { guardedLookup } from "@/server/crawler/fetch";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";
import { hitLimit } from "@/server/http/rate-limit";
import { log } from "@/server/log";
import { redis } from "@/server/redis";

import { aiProvider } from "./ai";
import { createDeal, updateDeal } from "./deals";
import { enrichOrganization, matchPerson } from "./enrichment";
import { recordEvent } from "./events";
import { addMembers, removeMembers } from "./lists";
import { notify } from "./notifications";
import { stageLabel } from "./record-stages";
import { enrollContacts, removeOrStopContacts } from "./sequences";
import { createTask } from "./tasks";
import {
  blockAt,
  childPath,
  entry,
  nextPath,
  type PathSegment,
  type RunLogEntry,
  registerRunExecutor,
  startRun,
} from "./workflow-engine";
import {
  allowPrivateHosts,
  delayMs,
  type EntityContext,
  evaluateAll,
  loadEntity,
  matchingIds,
  readSchedule,
  webhookUrlProblem,
} from "./workflow-model";
import { createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";

/**
 * Workflow runner: walks a run's block tree, waits on delays and resumes them, enrolls records
 * for scheduled triggers. Runs act with the permissions of the workflow's owner (the member who
 * launched it), re-checked on every pass. Registers itself with the engine when loaded.
 */

type WorkflowRow = typeof schema.workflow.$inferSelect;
type RunRow = typeof schema.workflowRun.$inferSelect;

/** Max enrollments started by one scheduled run. */
export const MAX_SCHEDULED_ENROLLMENTS = 1000;
const MAX_STEPS_PER_PASS = 200;
const MAX_LOG = 500;
const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_LIMIT = { max: 60, window: 60 };

/* -------------------------------------------------------------------------- */
/* Owner permissions                                                          */
/* -------------------------------------------------------------------------- */

async function memberRole(userId: string | null, organizationId: string): Promise<Role | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  return row && isRole(row.role) ? row.role : null;
}

function ownerActor(workflow: WorkflowRow, role: Role): Actor {
  return {
    kind: "user",
    userId: workflow.createdById,
    apiKeyId: null,
    organizationId: workflow.organizationId,
    role,
    isPlatformAdmin: false,
    tenant: { kind: "primary", host: "workflows" },
  };
}

const UPDATE_PERMISSION: Record<WorkflowTarget, Permission> = {
  contact: "contact:update",
  company: "company:update",
  deal: "deal:update",
};

function tableFor(target: WorkflowTarget) {
  if (target === "company") return schema.company;
  if (target === "deal") return schema.deal;
  return schema.contact;
}

const ACTION_PERMISSION: Partial<Record<WorkflowBlock["type"], (target: WorkflowTarget) => Permission>> = {
  add_to_list: () => "list:update",
  remove_from_list: () => "list:update",
  add_to_sequence: () => "sequence:launch",
  remove_from_sequence: () => "sequence:launch",
  create_task: () => "task:create",
  update_record: (t) => UPDATE_PERMISSION[t],
  create_deal: () => "deal:create",
  update_deal_stage: () => "deal:update",
  enrich: () => "enrich:run",
  research_ai: () => "ai:use",
  qualify_ai: () => "ai:use",
};

/* -------------------------------------------------------------------------- */
/* Execution                                                                  */
/* -------------------------------------------------------------------------- */

async function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T | null> {
  const client = redis();
  const key = `anhour:wf:run:${runId}`;
  const token = crypto.randomUUID();
  let locked = false;
  if (client) {
    try {
      locked = (await client.set(key, token, "PX", 120_000, "NX")) === "OK";
      if (!locked) return null;
    } catch {
      locked = false;
    }
  }
  try {
    return await fn();
  } finally {
    if (client && locked) {
      try {
        const current = await client.get(key);
        if (current === token) await client.del(key);
      } catch {
        // The lock expires on its own.
      }
    }
  }
}

interface ActionResult {
  status: "ok" | "skipped" | "failed";
  message: string;
}

class RunFailure extends Error {}

/** Execute (or continue) one run until it waits, exits, fails or finishes. Idempotent per run. */
export async function executeRun(runId: string): Promise<void> {
  await withRunLock(runId, async () => {
    const [run] = await db.select().from(schema.workflowRun).where(eq(schema.workflowRun.id, runId)).limit(1);
    if (run?.status !== "running") return;
    const [workflow] = await db.select().from(schema.workflow).where(eq(schema.workflow.id, run.workflowId)).limit(1);
    if (!workflow) return;
    await walkRun(workflow, run);
  });
}

async function saveRun(
  run: RunRow,
  logEntries: RunLogEntry[],
  patch: Partial<Pick<RunRow, "status" | "cursor" | "resumeAt" | "finishedAt">>,
): Promise<void> {
  const trimmed = logEntries.length > MAX_LOG ? logEntries.slice(-MAX_LOG) : logEntries;
  await db
    .update(schema.workflowRun)
    .set({ ...patch, log: trimmed })
    .where(eq(schema.workflowRun.id, run.id));
}

async function walkRun(workflow: WorkflowRow, run: RunRow): Promise<void> {
  const blocks = workflow.blocks as WorkflowBlock[];
  const logs = [...(run.log as RunLogEntry[])];
  const finish = (status: "completed" | "failed" | "exited", message?: string) => {
    if (message) logs.push(entry(null, status, status === "failed" ? "failed" : "info", message));
    return saveRun(run, logs, { status, cursor: { path: null }, resumeAt: null, finishedAt: new Date() });
  };

  if (workflow.status !== "active") {
    logs.push(entry(null, "paused", "info", "The workflow is paused. The run continues when it's launched again."));
    await saveRun(run, logs, { status: "waiting", resumeAt: new Date() });
    return;
  }
  const role = await memberRole(workflow.createdById, workflow.organizationId);
  if (!role || !can(role, "workflow:launch")) {
    await finish(
      "failed",
      "The workflow's owner no longer has permission to run workflows. Relaunch it as someone who does.",
    );
    return;
  }
  const actor = ownerActor(workflow, role);
  let entity = await loadEntity(workflow.organizationId, workflow.targetType, run.entityId);
  if (!entity) {
    await finish("exited", "The record no longer exists.");
    return;
  }

  let path = ((run.cursor as { path?: PathSegment[] | null } | null)?.path ?? null) as PathSegment[] | null;
  for (let steps = 0; path && steps < MAX_STEPS_PER_PASS; steps++) {
    const at: PathSegment[] = path;
    const block = blockAt(blocks, at);
    if (!block) break;
    const label = BLOCK_INFO[block.type]?.label ?? block.type;
    try {
      switch (block.type) {
        case "delay": {
          const ms = delayMs(block.config as { amount: number; unit: "minutes" | "hours" | "days" });
          const resumeAt = new Date(Date.now() + ms);
          const next = nextPath(blocks, path);
          logs.push(entry(block.id, block.type, "waiting", `Waiting until ${resumeAt.toISOString()}.`));
          await saveRun(run, logs, { status: "waiting", resumeAt, cursor: { path: next } });
          return;
        }
        case "exit":
          await finish("exited", "Reached an exit.");
          return;
        case "branch_if": {
          const c = block.config as { match: "all" | "any"; conditions: WorkflowCondition[] };
          const ok = await evaluateAll(entity, c.conditions, c.match);
          logs.push(
            entry(block.id, block.type, "ok", `Conditions ${ok ? "matched: yes path" : "didn't match: no path"}.`),
          );
          path = childPath(blocks, path, ok ? "yes" : "no");
          break;
        }
        case "split_multi": {
          const cases = (block.config.cases ?? []) as {
            key: string;
            label?: string;
            match: "all" | "any";
            conditions: WorkflowCondition[];
          }[];
          let chosen = "else";
          for (const cs of cases) {
            if (cs.conditions.length && (await evaluateAll(entity, cs.conditions, cs.match))) {
              chosen = cs.key;
              break;
            }
          }
          const name = cases.find((c) => c.key === chosen)?.label ?? (chosen === "else" ? "Everyone else" : chosen);
          logs.push(entry(block.id, block.type, "ok", `Took the path "${name}".`));
          path = childPath(blocks, path, chosen);
          break;
        }
        case "split_traffic": {
          const splits = (block.config.splits ?? []) as { key: string; percent: number; label?: string }[];
          const roll = Math.random() * 100;
          let acc = 0;
          let chosen = splits[splits.length - 1]?.key ?? "";
          for (const s of splits) {
            acc += s.percent;
            if (roll < acc) {
              chosen = s.key;
              break;
            }
          }
          logs.push(entry(block.id, block.type, "ok", `Traffic split: path ${chosen}.`));
          path = childPath(blocks, path, chosen);
          break;
        }
        default: {
          const permission = ACTION_PERMISSION[block.type]?.(workflow.targetType);
          if (permission && !can(role, permission)) {
            throw new RunFailure(
              `The workflow's owner no longer has permission for “${label}” (${permission}). The run stopped.`,
            );
          }
          const result = await runAction(block, entity, actor, workflow, run);
          logs.push(entry(block.id, block.type, result.status, result.message));
          entity = (await loadEntity(workflow.organizationId, workflow.targetType, run.entityId)) ?? entity;
          path = nextPath(blocks, path);
        }
      }
    } catch (error) {
      if (error instanceof RunFailure) {
        logs.push(entry(block.id, block.type, "failed", error.message));
        await finish("failed");
        return;
      }
      log.error("workflow step failed", { component: "workflows", runId: run.id, blockId: block.id, error });
      logs.push(entry(block.id, block.type, "failed", `${label} failed: ${plainError(error)}`));
      path = nextPath(blocks, at);
    }
    await saveRun(run, logs, { cursor: { path } });
  }
  if (path) {
    // Step budget used up: continue on the next pass.
    logs.push(entry(null, "paused", "info", "Continuing shortly."));
    await saveRun(run, logs, { status: "waiting", resumeAt: new Date(), cursor: { path } });
    return;
  }
  await finish("completed", "Finished.");
}

function plainError(error: unknown): string {
  if (error instanceof HttpError) {
    const details = Array.isArray(error.details) ? (error.details as { message?: string }[]) : [];
    return details[0]?.message ?? error.message;
  }
  return "something went wrong";
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

async function runAction(
  block: WorkflowBlock,
  entity: EntityContext,
  actor: Actor,
  workflow: WorkflowRow,
  run: RunRow,
): Promise<ActionResult> {
  const c = block.config;
  switch (block.type) {
    case "add_to_list":
    case "remove_from_list": {
      const [list] = await db
        .select({ id: schema.list.id, entityType: schema.list.entityType, name: schema.list.name })
        .from(schema.list)
        .where(and(eq(schema.list.organizationId, workflow.organizationId), eq(schema.list.id, String(c.listId))))
        .limit(1);
      if (!list) return { status: "failed", message: "The list no longer exists." };
      const id = list.entityType === "contact" ? entity.contactId : entity.companyId;
      if (!id)
        return { status: "skipped", message: `No ${list.entityType === "contact" ? "person" : "company"} to add.` };
      if (block.type === "add_to_list") {
        const result = await addMembers(actor, { listId: list.id, entityIds: [id] });
        return { status: "ok", message: result.added ? `Added to ${list.name}.` : `Already in ${list.name}.` };
      }
      const result = await removeMembers(actor, { listId: list.id, entityIds: [id] });
      return { status: "ok", message: result.removed ? `Removed from ${list.name}.` : `Wasn't in ${list.name}.` };
    }
    case "add_to_sequence": {
      if (!entity.contactId) return { status: "skipped", message: "No person to enroll." };
      const result = await enrollContacts(actor, String(c.sequenceId), { contactIds: [entity.contactId] });
      if (result.enrolled.length) return { status: "ok", message: "Enrolled in the sequence." };
      return { status: "skipped", message: result.skipped[0]?.message ?? "Not enrolled." };
    }
    case "remove_from_sequence": {
      if (!entity.contactId) return { status: "skipped", message: "No person to remove." };
      const rows = await db
        .select({ sequenceId: schema.enrollment.sequenceId })
        .from(schema.enrollment)
        .where(
          and(
            eq(schema.enrollment.organizationId, workflow.organizationId),
            eq(schema.enrollment.contactId, entity.contactId),
            inArray(schema.enrollment.status, ["active", "paused"]),
            c.sequenceId && c.sequenceId !== "all" ? eq(schema.enrollment.sequenceId, String(c.sequenceId)) : undefined,
          ),
        );
      if (!rows.length) return { status: "skipped", message: "No active sequence enrollments." };
      await removeOrStopContacts(actor, {
        sequenceIds: [...new Set(rows.map((r) => r.sequenceId))],
        contactIds: [entity.contactId],
        mode: "remove",
      });
      return { status: "ok", message: `Removed from ${rows.length} ${rows.length === 1 ? "sequence" : "sequences"}.` };
    }
    case "create_task": {
      const assignee = String(c.assignee ?? "owner");
      let assigneeId: string | null = assignee;
      if (assignee === "owner") assigneeId = entity.ownerId ?? workflow.createdById;
      else if (assignee === "creator") assigneeId = workflow.createdById;
      const dueAt = new Date(Date.now() + Number(c.dueInDays ?? 1) * 86_400_000);
      const task = await createTask(actor, {
        title: String(c.title || `Follow up with ${entity.name}`).slice(0, 200),
        type: c.taskType as Parameters<typeof createTask>[1]["type"],
        priority: c.priority as Parameters<typeof createTask>[1]["priority"],
        assigneeId: assigneeId ?? undefined,
        contactId: entity.contactId ?? undefined,
        companyId: entity.contactId ? undefined : (entity.companyId ?? undefined),
        note: typeof c.note === "string" && c.note ? c.note : undefined,
        dueAt,
      });
      return { status: "ok", message: `Task “${task.title}” created.` };
    }
    case "update_record":
      return updateRecord(block, entity, actor, workflow);
    case "create_deal": {
      const deal = await createDeal(actor, {
        name: String(c.name || `${entity.name} deal`).slice(0, 200),
        pipelineId: typeof c.pipelineId === "string" ? c.pipelineId : undefined,
        stageId: typeof c.stageId === "string" ? c.stageId : undefined,
        amount: typeof c.amount === "number" ? c.amount : null,
        contactId: entity.contactId,
        companyId: entity.companyId,
        ownerId: entity.ownerId ?? workflow.createdById,
      });
      return { status: "ok", message: `Deal “${deal.name}” created in ${deal.stageName}.` };
    }
    case "update_deal_stage": {
      if (!entity.dealId) return { status: "skipped", message: "This record isn't a deal." };
      const deal = await updateDeal(actor, entity.dealId, { stageId: String(c.stageId) });
      return { status: "ok", message: `Moved to ${deal.stageName}.` };
    }
    case "enrich": {
      if (entity.target === "contact") {
        await matchPerson(actor, { contactId: entity.id, verify: true });
        return { status: "ok", message: "Enrichment ran for this person." };
      }
      if (entity.target === "company") {
        await enrichOrganization(actor, { companyId: entity.id });
        return { status: "ok", message: "Enrichment ran for this company." };
      }
      return { status: "skipped", message: "Deals can't be enriched." };
    }
    case "notify": {
      const recipients = c.recipients;
      let userIds: string[] = [];
      if (recipients === "owner") userIds = [entity.ownerId ?? workflow.createdById ?? ""];
      else if (recipients === "creator") userIds = [workflow.createdById ?? ""];
      else if (Array.isArray(recipients)) userIds = recipients.map(String);
      const sent = await notify(
        userIds.filter(Boolean),
        {
          type: "workflow",
          title: String(c.message || `${workflow.name}: ${entity.name}`),
          body: `${workflow.name} · ${entity.name}`,
          link: linkFor(entity),
        },
        workflow.organizationId,
      );
      return sent
        ? { status: "ok", message: `Notified ${sent} ${sent === 1 ? "teammate" : "teammates"}.` }
        : { status: "skipped", message: "Nobody to notify." };
    }
    case "webhook":
      return sendWebhook(block, entity, workflow, run);
    case "research_ai":
    case "qualify_ai": {
      const provider = aiProvider();
      if (!provider) {
        return {
          status: "skipped",
          message: "Needs an AI provider. An administrator can set one up for this installation.",
        };
      }
      const prompt = typeof c.prompt === "string" && c.prompt ? c.prompt : "";
      const summary = await provider.complete({
        system:
          block.type === "research_ai"
            ? "You research B2B records. Summarise what is known in three short sentences. Don't invent facts."
            : "You qualify B2B records against the user's criteria. Answer 'qualified' or 'not qualified' with one sentence why.",
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nRecord: ${JSON.stringify(publicFields(entity)).slice(0, 4000)}`,
          },
        ],
        maxTokens: 300,
      });
      return { status: "ok", message: summary.slice(0, 500) };
    }
    default:
      return { status: "skipped", message: "Nothing to do." };
  }
}

function linkFor(entity: EntityContext): string {
  if (entity.target === "contact") return `/dashboard/people/${entity.id}`;
  if (entity.target === "company") return `/dashboard/companies/${entity.id}`;
  return `/dashboard/deals?deal=${entity.id}`;
}

/** Fields a webhook or an AI step may see: no internal columns. */
function publicFields(entity: EntityContext): Record<string, unknown> {
  const skip = new Set(["organizationId", "customFields"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entity.fields)) {
    if (skip.has(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  out.customFields = entity.fields.customFields ?? {};
  return out;
}

async function updateRecord(
  block: WorkflowBlock,
  entity: EntityContext,
  actor: Actor,
  workflow: WorkflowRow,
): Promise<ActionResult> {
  const c = block.config as { field: "stage" | "owner" | "customField"; value?: unknown; customFieldKey?: string };
  const org = workflow.organizationId;
  if (c.field === "owner") {
    const ownerId = String(c.value ?? "");
    const role = await memberRole(ownerId, org);
    if (!role) return { status: "failed", message: "The new owner isn't a member of this workspace." };
    const table = tableFor(entity.target);
    await db
      .update(table)
      .set({ ownerId })
      .where(and(eq(table.organizationId, org), eq(table.id, entity.id)));
    return { status: "ok", message: "Owner changed." };
  }
  if (c.field === "customField") {
    const key = String(c.customFieldKey ?? "");
    const table = tableFor(entity.target);
    await db
      .update(table)
      .set({
        customFields: sql`coalesce(${table.customFields}, '{}'::jsonb) || ${JSON.stringify({ [key]: c.value ?? null })}::jsonb`,
      })
      .where(and(eq(table.organizationId, org), eq(table.id, entity.id)));
    return { status: "ok", message: `Field ${key} updated.` };
  }
  const stage = String(c.value ?? "");
  const from = String(entity.fields.stage ?? "");
  if (from === stage) return { status: "skipped", message: "Already in that stage." };
  if (entity.target === "contact") {
    await db
      .update(schema.contact)
      .set({ stage: stage as (typeof schema.contact.$inferInsert)["stage"] })
      .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.id, entity.id)));
  } else if (entity.target === "company") {
    await db
      .update(schema.company)
      .set({ stage: stage as (typeof schema.company.$inferInsert)["stage"] })
      .where(and(eq(schema.company.organizationId, org), eq(schema.company.id, entity.id)));
  } else {
    return { status: "skipped", message: "Use “Move deal stage” for deals." };
  }
  const entityType = entity.target === "company" ? "company" : "contact";
  await recordEvent({
    organizationId: org,
    type: "stage_changed",
    summary: `Stage changed from ${await stageLabel(org, from, entityType)} to ${await stageLabel(org, stage, entityType)} by the workflow ${workflow.name}`,
    contactId: entity.target === "contact" ? entity.id : null,
    companyId: entity.target === "company" ? entity.id : entity.companyId,
    actorUserId: actor.userId,
    metadata: { manual: false, cause: "workflow", workflowId: workflow.id, from, to: stage },
  });
  return { status: "ok", message: `Stage set to ${await stageLabel(org, stage, entityType)}.` };
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function postJson(url: URL, body: string, headers: Record<string, string>, allowPrivate: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "POST",
        lookup: guardedLookup(allowPrivate),
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers },
        timeout: WEBHOOK_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), WEBHOOK_TIMEOUT_MS);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("close", () => clearTimeout(timer));
    req.end(body);
  });
}

async function sendWebhook(
  block: WorkflowBlock,
  entity: EntityContext,
  workflow: WorkflowRow,
  run: RunRow,
): Promise<ActionResult> {
  const rawUrl = String(block.config.url ?? "");
  const secret = String(block.config.secret ?? "");
  const allowPrivate = allowPrivateHosts();
  const problem = webhookUrlProblem(rawUrl, allowPrivate);
  if (problem) return { status: "failed", message: problem };
  if (!secret) return { status: "failed", message: "Set a signing secret for this webhook." };
  const { allowed } = await hitLimit(`wf-webhook:${workflow.id}`, WEBHOOK_LIMIT);
  if (!allowed)
    return { status: "failed", message: "Webhook rate limit reached (60 a minute). This call was skipped." };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    event: "workflow.webhook",
    workflow: { id: workflow.id, name: workflow.name },
    runId: run.id,
    blockId: block.id,
    record: { type: entity.target, id: entity.id, name: entity.name, ...publicFields(entity) },
    sentAt: new Date().toISOString(),
  });
  try {
    const status = await postJson(
      new URL(rawUrl),
      body,
      {
        "user-agent": "AnhourLeads-Workflows/1.0",
        "x-anhour-timestamp": timestamp,
        "x-anhour-signature": signWebhook(secret, timestamp, body),
      },
      allowPrivate,
    );
    if (status >= 200 && status < 300) return { status: "ok", message: `Webhook delivered (HTTP ${status}).` };
    return { status: "failed", message: `The endpoint answered HTTP ${status}.` };
  } catch (error) {
    if ((error as { code?: string }).code === "EBLOCKEDHOST") {
      return { status: "failed", message: "Webhooks can't call private or internal addresses." };
    }
    if ((error as Error).message === "timeout") {
      return { status: "failed", message: "The endpoint didn't answer within 5 seconds." };
    }
    return { status: "failed", message: "Couldn't reach the endpoint." };
  }
}

/* -------------------------------------------------------------------------- */
/* Schedules and resumes                                                      */
/* -------------------------------------------------------------------------- */

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The latest scheduled instant at or before `now`, or null when there is none. */
export function latestOccurrence(schedule: Record<string, unknown> | null, now = new Date()): Date | null {
  const s = readSchedule(schedule);
  if (!s) return null;
  if (s.at) {
    const at = new Date(s.at);
    return at <= now ? at : null;
  }
  if (!s.weekly) return null;
  const [hh, mm] = s.weekly.time.split(":").map(Number);
  const localNow = new Date(now.getTime() + tzOffsetMs(now, s.timezone));
  for (let back = 0; back <= 7; back++) {
    const day = new Date(
      Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() - back, hh, mm),
    );
    const weekday = WEEKDAYS[(day.getUTCDay() + 6) % 7];
    if (!s.weekly.days.includes(weekday)) continue;
    const instant = new Date(day.getTime() - tzOffsetMs(day, s.timezone));
    if (instant <= now) return instant;
  }
  return null;
}

/** Enroll every matching record (up to the cap) into scheduled workflows that are due. */
export async function runSchedules(workflowId?: string): Promise<number> {
  const due = await db
    .select()
    .from(schema.workflow)
    .where(
      and(
        eq(schema.workflow.status, "active"),
        eq(schema.workflow.triggerType, "schedule"),
        workflowId ? eq(schema.workflow.id, workflowId) : undefined,
      ),
    );
  let started = 0;
  for (const wf of due) {
    const occurrence = latestOccurrence(wf.schedule);
    if (!occurrence || (wf.lastRunAt && wf.lastRunAt >= occurrence)) continue;
    // Claim this occurrence so concurrent passes don't enroll twice.
    const claimed = await db
      .update(schema.workflow)
      .set({ lastRunAt: new Date() })
      .where(
        and(
          eq(schema.workflow.id, wf.id),
          wf.lastRunAt ? eq(schema.workflow.lastRunAt, wf.lastRunAt) : isNull(schema.workflow.lastRunAt),
        ),
      )
      .returning({ id: schema.workflow.id });
    if (!claimed.length) continue;
    const ids = await matchingIds(
      wf.organizationId,
      wf.targetType,
      wf.enrollmentFilters as EnrollmentFilters,
      MAX_SCHEDULED_ENROLLMENTS,
    );
    const runIds: string[] = [];
    for (const id of ids) {
      const runId = await startRun(wf, id, `scheduled run ${occurrence.toISOString()}`);
      if (runId) runIds.push(runId);
    }
    log.info("scheduled workflow enrolled records", {
      component: "workflows",
      workflowId: wf.id,
      enrolled: runIds.length,
    });
    for (const runId of runIds) await executeRun(runId);
    started += runIds.length;
  }
  return started;
}

/** Resume waiting runs whose delay has passed (only for active workflows). */
export async function resumeDue(workflowId?: string, limit = 200): Promise<number> {
  const candidates = await db
    .select({ id: schema.workflowRun.id })
    .from(schema.workflowRun)
    .innerJoin(schema.workflow, eq(schema.workflow.id, schema.workflowRun.workflowId))
    .where(
      and(
        eq(schema.workflowRun.status, "waiting"),
        or(isNull(schema.workflowRun.resumeAt), lte(schema.workflowRun.resumeAt, new Date())),
        eq(schema.workflow.status, "active"),
        workflowId ? eq(schema.workflow.id, workflowId) : undefined,
      ),
    )
    .orderBy(asc(schema.workflowRun.resumeAt))
    .limit(limit);
  let resumed = 0;
  for (const { id } of candidates) {
    const claimed = await db
      .update(schema.workflowRun)
      .set({ status: "running" })
      .where(and(eq(schema.workflowRun.id, id), eq(schema.workflowRun.status, "waiting")))
      .returning({ id: schema.workflowRun.id });
    if (!claimed.length) continue;
    await executeRun(id);
    resumed += 1;
  }
  return resumed;
}

/** One pass of the scheduler job, or a pass limited to one workflow (`run_due`). */
export async function processDue(workflowId?: string): Promise<{ enrolled: number; resumed: number }> {
  const enrolled = await runSchedules(workflowId);
  const resumed = await resumeDue(workflowId);
  return { enrolled, resumed };
}

/* -------------------------------------------------------------------------- */
/* Dry run                                                                    */
/* -------------------------------------------------------------------------- */

export interface DryRunStep {
  blockId: string;
  type: string;
  label: string;
  outcome: string;
}

/** Walk the tree for one record without running any action. Traffic splits pick a stable path. */
export async function dryRun(workflow: WorkflowRow, entity: EntityContext): Promise<DryRunStep[]> {
  const blocks = workflow.blocks as WorkflowBlock[];
  const steps: DryRunStep[] = [];
  let path: PathSegment[] | null = blocks.length ? [0] : null;
  let hash = 0;
  for (const ch of entity.id) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000;
  while (path && steps.length < MAX_STEPS_PER_PASS) {
    const block = blockAt(blocks, path);
    if (!block) break;
    const label = BLOCK_INFO[block.type]?.label ?? block.type;
    if (block.type === "branch_if") {
      const c = block.config as { match: "all" | "any"; conditions: WorkflowCondition[] };
      const ok = await evaluateAll(entity, c.conditions, c.match);
      steps.push({ blockId: block.id, type: block.type, label, outcome: ok ? "yes" : "no" });
      path = childPath(blocks, path, ok ? "yes" : "no");
      continue;
    }
    if (block.type === "split_multi") {
      const cases = (block.config.cases ?? []) as {
        key: string;
        match: "all" | "any";
        conditions: WorkflowCondition[];
      }[];
      let chosen = "else";
      for (const cs of cases) {
        if (cs.conditions.length && (await evaluateAll(entity, cs.conditions, cs.match))) {
          chosen = cs.key;
          break;
        }
      }
      steps.push({ blockId: block.id, type: block.type, label, outcome: chosen });
      path = childPath(blocks, path, chosen);
      continue;
    }
    if (block.type === "split_traffic") {
      const splits = (block.config.splits ?? []) as { key: string; percent: number }[];
      const roll = hash % 100;
      let acc = 0;
      let chosen = splits[splits.length - 1]?.key ?? "";
      for (const s of splits) {
        acc += s.percent;
        if (roll < acc) {
          chosen = s.key;
          break;
        }
      }
      steps.push({ blockId: block.id, type: block.type, label, outcome: chosen });
      path = childPath(blocks, path, chosen);
      continue;
    }
    if (block.type === "exit") {
      steps.push({ blockId: block.id, type: block.type, label, outcome: "exit" });
      break;
    }
    steps.push({
      blockId: block.id,
      type: block.type,
      label,
      outcome: block.type === "delay" ? "would wait" : "would run",
    });
    path = nextPath(blocks, path);
  }
  return steps;
}

registerRunExecutor(executeRun);
