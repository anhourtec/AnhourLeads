import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import type { EnrollmentFilters, WorkflowBlock, WorkflowTarget } from "@/lib/workflows";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import type { RecordEvent } from "./events";
import { entityMatches, readSettings } from "./workflow-model";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Workflow enrollment, called by the event hub (recordEvent): starts runs for active workflows
 * whose trigger matches and whose enrollment criteria the record meets. Execution lives in
 * workflow-runner.ts (it calls services that record events, so the hub must not import it); the
 * runner registers itself here when loaded. Without a runner in this process, new runs wait for
 * the scheduler's next pass. Nothing here throws into the event caller.
 */

type WorkflowRow = typeof schema.workflow.$inferSelect;
export type PathSegment = number | string;

export interface RunLogEntry {
  at: string;
  blockId: string | null;
  type: string;
  status: "ok" | "skipped" | "failed" | "waiting" | "info";
  message: string;
}

const MAX_EVENT_DEPTH = 3;

/** How deep we are in workflow → action → event → workflow chains, to stop loops. */
const depth = new AsyncLocalStorage<number>();

type Executor = (runId: string) => Promise<void>;
const registry = globalThis as unknown as { anhourWorkflowExecutor?: Executor };

/** The runner registers its executor here when its module loads. */
export function registerRunExecutor(executor: Executor): void {
  registry.anhourWorkflowExecutor = executor;
}

export function currentDepth(): number {
  return depth.getStore() ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Tree navigation                                                            */
/* -------------------------------------------------------------------------- */

export function blockAt(blocks: WorkflowBlock[], path: PathSegment[]): WorkflowBlock | null {
  let list: WorkflowBlock[] | undefined = blocks;
  let block: WorkflowBlock | null = null;
  for (let i = 0; i < path.length; i += 2) {
    const index = path[i];
    if (typeof index !== "number" || !list) return null;
    block = list[index] ?? null;
    if (!block) return null;
    const key = path[i + 1];
    if (key !== undefined) list = block.branches?.[String(key)];
  }
  return block;
}

/** The block after `path` in the same path, or null (branches don't rejoin). */
export function nextPath(blocks: WorkflowBlock[], path: PathSegment[]): PathSegment[] | null {
  const next = [...path.slice(0, -1), (path[path.length - 1] as number) + 1];
  return blockAt(blocks, next) ? next : null;
}

export function childPath(blocks: WorkflowBlock[], path: PathSegment[], key: string): PathSegment[] | null {
  const child = [...path, key, 0];
  return blockAt(blocks, child) ? child : null;
}

/* -------------------------------------------------------------------------- */
/* Enrollment                                                                 */
/* -------------------------------------------------------------------------- */

async function entityFor(
  target: WorkflowTarget,
  event: Pick<RecordEvent, "organizationId" | "contactId" | "companyId" | "dealId">,
): Promise<string | null> {
  if (target === "contact") return event.contactId ?? null;
  if (target === "deal") return event.dealId ?? null;
  if (event.companyId) return event.companyId;
  if (event.contactId) {
    const [row] = await db
      .select({ companyId: schema.contact.companyId })
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, event.organizationId), eq(schema.contact.id, event.contactId)))
      .limit(1);
    return row?.companyId ?? null;
  }
  return null;
}

export function entry(
  blockId: string | null,
  type: string,
  status: RunLogEntry["status"],
  message: string,
): RunLogEntry {
  return { at: new Date().toISOString(), blockId, type, status, message };
}

/**
 * Start a run for one record unless one is already running or waiting (and, with re-enrollment
 * off, unless the record ran before). Returns the run id, or null when skipped.
 */
export async function startRun(workflow: WorkflowRow, entityId: string, cause: string): Promise<string | null> {
  const allowReenroll = readSettings(workflow.schedule).allowReenroll;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wfrun:${workflow.id}:${entityId}`}))`);
    const existing = await tx
      .select({ status: schema.workflowRun.status })
      .from(schema.workflowRun)
      .where(and(eq(schema.workflowRun.workflowId, workflow.id), eq(schema.workflowRun.entityId, entityId)))
      .orderBy(desc(schema.workflowRun.startedAt))
      .limit(1);
    if (existing[0] && (["running", "waiting"].includes(existing[0].status) || !allowReenroll)) return null;
    const [run] = await tx
      .insert(schema.workflowRun)
      .values({
        organizationId: workflow.organizationId,
        workflowId: workflow.id,
        entityType: workflow.targetType,
        entityId,
        status: "running",
        cursor: { path: (workflow.blocks as WorkflowBlock[]).length ? [0] : null },
        log: [entry(null, "enrolled", "info", `Enrolled: ${cause}.`)],
      })
      .returning({ id: schema.workflowRun.id });
    await tx.update(schema.workflow).set({ lastRunAt: new Date() }).where(eq(schema.workflow.id, workflow.id));
    return run.id;
  });
}

async function runDetached(runId: string): Promise<void> {
  const executor = registry.anhourWorkflowExecutor;
  if (!executor) {
    // No runner loaded in this process: the scheduler picks the run up on its next pass.
    await db
      .update(schema.workflowRun)
      .set({ status: "waiting", resumeAt: new Date() })
      .where(eq(schema.workflowRun.id, runId));
    return;
  }
  const level = currentDepth() + 1;
  void depth
    .run(level, () => executor(runId))
    .catch((error: unknown) => {
      log.error("workflow run crashed", { component: "workflows", runId, error });
    });
}

/** Called by recordEvent() for every event: enroll records into matching active workflows. */
export async function enqueueWorkflowRuns(event: RecordEvent): Promise<void> {
  try {
    const level = currentDepth();
    if (level >= MAX_EVENT_DEPTH) {
      log.warn("workflow chain too deep, event not enrolled", { component: "workflows", type: event.type, level });
      return;
    }
    const workflows = await db
      .select()
      .from(schema.workflow)
      .where(
        and(
          eq(schema.workflow.organizationId, event.organizationId),
          eq(schema.workflow.status, "active"),
          eq(schema.workflow.triggerType, "event"),
          eq(schema.workflow.triggerEvent, event.type),
        ),
      );
    for (const wf of workflows) {
      try {
        const entityId = await entityFor(wf.targetType, event);
        if (!entityId) continue;
        const filters = wf.enrollmentFilters as EnrollmentFilters;
        if (!(await entityMatches(wf.organizationId, wf.targetType, entityId, filters))) continue;
        const runId = await startRun(wf, entityId, event.summary || event.type);
        if (runId) await runDetached(runId);
      } catch (error) {
        log.error("workflow enrollment failed", { component: "workflows", workflowId: wf.id, error });
      }
    }
  } catch (error) {
    log.error("workflow enqueue failed", { component: "workflows", type: event.type, error });
  }
}
