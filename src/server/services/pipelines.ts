import "server-only";

import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  LEGACY_TO_DEFAULT_STAGE,
  legacyStageFor,
  PIPELINE_STAGE_TYPES,
  type PipelineStageType,
  stageListProblem,
} from "@/lib/deal-pipelines";
import type { DealStage } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";

import { audit } from "./audit";

const { pipeline, pipelineStage, deal } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export interface PipelineStageDto {
  id: string;
  name: string;
  position: number;
  type: PipelineStageType;
  probability: number | null;
  legacyStage: DealStage;
  dealCount: number;
  amount: number;
}

export interface PipelineDto {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  stages: PipelineStageDto[];
}

/* -------------------------------------------------------------------------- */
/* Default pipeline and legacy mapping                                        */
/* -------------------------------------------------------------------------- */

type StageRow = typeof pipelineStage.$inferSelect;

/** Legacy value for every stage of one pipeline (open stages are mapped by their place in the order). */
export function legacyMap(stages: Pick<StageRow, "id" | "name" | "type" | "probability" | "position">[]) {
  const open = [...stages].filter((s) => s.type === "open").sort((a, b) => a.position - b.position);
  const map = new Map<string, DealStage>();
  for (const s of stages) {
    map.set(s.id, legacyStageFor(s, open.indexOf(s as (typeof open)[number]), open.length));
  }
  return map;
}

/** The stage of a pipeline that best matches a legacy value (for API callers that still send `stage`). */
export function stageForLegacy(
  stages: Pick<StageRow, "id" | "name" | "type" | "probability" | "position">[],
  legacy: DealStage,
): string | null {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  if (legacy === "won" || legacy === "lost") return ordered.find((s) => s.type === legacy)?.id ?? null;
  const preferred = ordered.find((s) => s.type === "open" && s.name === LEGACY_TO_DEFAULT_STAGE[legacy]);
  if (preferred) return preferred.id;
  const map = legacyMap(ordered);
  return (
    ordered.find((s) => s.type === "open" && map.get(s.id) === legacy)?.id ??
    ordered.find((s) => s.type === "open")?.id ??
    null
  );
}

const ensured = new Set<string>();

/**
 * Make sure the workspace has a pipeline. The first call creates "Pipeline 1" with the default
 * stages and moves every deal without a pipeline onto it, mapping the legacy stage. Safe to call
 * concurrently (advisory lock per workspace) and cheap after the first call in a process.
 */
export async function ensureDefaultPipeline(organizationId: string): Promise<void> {
  if (ensured.has(organizationId)) {
    // Deals created by older code paths (or fixtures) still get a pipeline.
    const [orphan] = await db
      .select({ id: deal.id })
      .from(deal)
      .where(and(eq(deal.organizationId, organizationId), isNull(deal.pipelineId)))
      .limit(1);
    if (!orphan) return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pipeline:${organizationId}`}))`);
    let [current] = await tx
      .select()
      .from(pipeline)
      .where(eq(pipeline.organizationId, organizationId))
      .orderBy(sql`${pipeline.isDefault} desc`, asc(pipeline.createdAt))
      .limit(1);
    if (!current) {
      [current] = await tx
        .insert(pipeline)
        .values({ organizationId, name: DEFAULT_PIPELINE_NAME, isDefault: true })
        .returning();
      await tx.insert(pipelineStage).values(
        DEFAULT_PIPELINE_STAGES.map((s, position) => ({
          pipelineId: current.id,
          name: s.name,
          type: s.type,
          probability: s.probability,
          position,
        })),
      );
    } else if (!current.isDefault) {
      await tx.update(pipeline).set({ isDefault: true }).where(eq(pipeline.id, current.id));
    }
    const stages = await tx.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, current.id));
    const orphans = await tx
      .select({ id: deal.id, stage: deal.stage })
      .from(deal)
      .where(and(eq(deal.organizationId, organizationId), isNull(deal.pipelineId)));
    const byLegacy = new Map<DealStage, string[]>();
    for (const o of orphans) byLegacy.set(o.stage, [...(byLegacy.get(o.stage) ?? []), o.id]);
    const map = legacyMap(stages);
    for (const [legacy, ids] of byLegacy) {
      const stageId = stageForLegacy(stages, legacy);
      if (!stageId) continue;
      await tx
        .update(deal)
        .set({ pipelineId: current.id, stageId, stage: map.get(stageId) ?? legacy })
        .where(inArray(deal.id, ids));
    }
  });
  ensured.add(organizationId);
}

export async function defaultPipelineId(organizationId: string): Promise<string> {
  await ensureDefaultPipeline(organizationId);
  const [row] = await db
    .select({ id: pipeline.id })
    .from(pipeline)
    .where(and(eq(pipeline.organizationId, organizationId), eq(pipeline.isDefault, true)))
    .limit(1);
  if (row) return row.id;
  const [any] = await db
    .select({ id: pipeline.id })
    .from(pipeline)
    .where(eq(pipeline.organizationId, organizationId))
    .orderBy(asc(pipeline.createdAt))
    .limit(1);
  if (!any) throw new HttpError(500, "No pipeline is set up for this workspace.");
  return any.id;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function stagesOf(exec: Exec, pipelineId: string): Promise<StageRow[]> {
  return exec
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.pipelineId, pipelineId))
    .orderBy(asc(pipelineStage.position));
}

export async function listPipelines(actor: Pick<Actor, "organizationId">): Promise<PipelineDto[]> {
  await ensureDefaultPipeline(actor.organizationId);
  const pipelines = await db
    .select()
    .from(pipeline)
    .where(eq(pipeline.organizationId, actor.organizationId))
    .orderBy(sql`${pipeline.isDefault} desc`, asc(pipeline.createdAt));
  if (!pipelines.length) return [];
  const stages = await db
    .select()
    .from(pipelineStage)
    .where(
      inArray(
        pipelineStage.pipelineId,
        pipelines.map((p) => p.id),
      ),
    )
    .orderBy(asc(pipelineStage.position));
  const totals = await db
    .select({
      stageId: deal.stageId,
      count: count(),
      amount: sql<number>`coalesce(sum(${deal.amount}), 0)::bigint`,
    })
    .from(deal)
    .where(eq(deal.organizationId, actor.organizationId))
    .groupBy(deal.stageId);
  const byStage = new Map(totals.map((t) => [t.stageId, t]));
  return pipelines.map((p) => {
    const own = stages.filter((s) => s.pipelineId === p.id);
    const map = legacyMap(own);
    return {
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      createdAt: p.createdAt.toISOString(),
      stages: own.map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        type: s.type,
        probability: s.probability,
        legacyStage: map.get(s.id) ?? "qualify",
        dealCount: byStage.get(s.id)?.count ?? 0,
        amount: Number(byStage.get(s.id)?.amount ?? 0),
      })),
    };
  });
}

export async function getPipeline(actor: Pick<Actor, "organizationId">, id: string): Promise<PipelineDto> {
  const found = (await listPipelines(actor)).find((p) => p.id === id);
  if (!found) throw notFound("Pipeline not found.");
  return found;
}

async function findPipeline(exec: Exec, organizationId: string, id: string) {
  const [row] = await exec
    .select()
    .from(pipeline)
    .where(and(eq(pipeline.organizationId, organizationId), eq(pipeline.id, id)))
    .limit(1);
  if (!row) throw notFound("Pipeline not found.");
  return row;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

const stageInput = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1, "Name every stage.").max(60),
  type: z.enum(PIPELINE_STAGE_TYPES).default("open"),
  probability: z.number().int().min(0).max(100).nullable().optional(),
});

const stageList = z
  .array(stageInput)
  .min(3, "A pipeline needs at least one open stage plus closed won and closed lost.")
  .max(30, "Use at most 30 stages.")
  .superRefine((stages, ctx) => {
    const problem = stageListProblem(stages);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const pipelineCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name the pipeline.").max(80),
    isDefault: z.boolean().optional(),
    stages: stageList.optional(),
  })
  .strict();

export const pipelineUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name the pipeline.").max(80).optional(),
    isDefault: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.isDefault !== undefined, { message: "Nothing to update." });

export const stagesReplaceSchema = z
  .object({
    stages: stageList,
    /** Removed stage id → stage that takes its deals (an id kept in `stages`). */
    moveDealsTo: z.record(z.string().max(64), z.string().max(64)).optional(),
  })
  .strict();

export const pipelineDeleteSchema = z
  .object({ moveDealsToPipelineId: z.string().trim().min(1).max(64).optional() })
  .strict();

function defaultProbability(type: PipelineStageType, probability: number | null | undefined): number | null {
  if (probability !== undefined && probability !== null) return probability;
  if (type === "won") return 100;
  if (type === "lost") return 0;
  return null;
}

/** Rewrite deal.stage for every deal of a pipeline from its stage's current legacy value. */
async function syncLegacy(tx: Tx, pipelineId: string): Promise<void> {
  const stages = await stagesOf(tx, pipelineId);
  const map = legacyMap(stages);
  for (const s of stages) {
    await tx
      .update(deal)
      .set({ stage: map.get(s.id) ?? "qualify" })
      .where(and(eq(deal.stageId, s.id), sql`${deal.stage} <> ${map.get(s.id) ?? "qualify"}`));
  }
}

export async function createPipeline(actor: Actor, input: z.infer<typeof pipelineCreateSchema>): Promise<PipelineDto> {
  await ensureDefaultPipeline(actor.organizationId);
  const stages = input.stages ?? DEFAULT_PIPELINE_STAGES;
  const id = await db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(pipeline).set({ isDefault: false }).where(eq(pipeline.organizationId, actor.organizationId));
    }
    const [created] = await tx
      .insert(pipeline)
      .values({ organizationId: actor.organizationId, name: input.name, isDefault: input.isDefault ?? false })
      .returning({ id: pipeline.id });
    await tx.insert(pipelineStage).values(
      stages.map((s, position) => ({
        pipelineId: created.id,
        name: s.name.trim(),
        type: s.type,
        probability: defaultProbability(s.type, s.probability),
        position,
      })),
    );
    return created.id;
  });
  await audit(actor, "pipeline.create", "pipeline", id, { stages: stages.length });
  return getPipeline(actor, id);
}

export async function updatePipeline(
  actor: Actor,
  id: string,
  input: z.infer<typeof pipelineUpdateSchema>,
): Promise<PipelineDto> {
  await db.transaction(async (tx) => {
    await findPipeline(tx, actor.organizationId, id);
    if (input.isDefault) {
      await tx.update(pipeline).set({ isDefault: false }).where(eq(pipeline.organizationId, actor.organizationId));
    }
    await tx
      .update(pipeline)
      .set({ ...(input.name !== undefined && { name: input.name }), ...(input.isDefault && { isDefault: true }) })
      .where(eq(pipeline.id, id));
  });
  await audit(actor, "pipeline.update", "pipeline", id, { fields: Object.keys(input) });
  return getPipeline(actor, id);
}

/** Replace the ordered stage list of a pipeline. Deals on removed stages must be moved somewhere. */
export async function replaceStages(
  actor: Actor,
  id: string,
  input: z.infer<typeof stagesReplaceSchema>,
): Promise<PipelineDto> {
  await db.transaction(async (tx) => {
    await findPipeline(tx, actor.organizationId, id);
    const current = await stagesOf(tx, id);
    const currentIds = new Set(current.map((s) => s.id));
    const keptIds = new Set(input.stages.flatMap((s) => (s.id ? [s.id] : [])));
    const issues: { path: string; message: string }[] = [];
    input.stages.forEach((s, i) => {
      if (s.id && !currentIds.has(s.id)) issues.push({ path: `stages.${i}.id`, message: "Stage not found." });
    });
    if (keptIds.size !== input.stages.filter((s) => s.id).length) {
      issues.push({ path: "stages", message: "Each stage may appear only once." });
    }
    const removed = current.filter((s) => !keptIds.has(s.id));
    const counts = removed.length
      ? await tx
          .select({ stageId: deal.stageId, n: count() })
          .from(deal)
          .where(
            inArray(
              deal.stageId,
              removed.map((r) => r.id),
            ),
          )
          .groupBy(deal.stageId)
      : [];
    for (const r of removed) {
      const n = counts.find((c) => c.stageId === r.id)?.n ?? 0;
      if (!n) continue;
      const target = input.moveDealsTo?.[r.id];
      if (!target || !keptIds.has(target)) {
        issues.push({
          path: `moveDealsTo.${r.id}`,
          message: `"${r.name}" has ${n} ${n === 1 ? "deal" : "deals"}. Choose a remaining stage to move them to.`,
        });
      }
    }
    if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);

    // Positions are unique only by convention; shift existing rows out of the way first.
    await tx
      .update(pipelineStage)
      .set({ position: sql`${pipelineStage.position} + 1000` })
      .where(eq(pipelineStage.pipelineId, id));
    for (const [position, s] of input.stages.entries()) {
      const values = {
        name: s.name.trim(),
        type: s.type,
        probability: defaultProbability(s.type, s.probability),
        position,
      };
      if (s.id) await tx.update(pipelineStage).set(values).where(eq(pipelineStage.id, s.id));
      else await tx.insert(pipelineStage).values({ pipelineId: id, ...values });
    }
    for (const r of removed) {
      const target = input.moveDealsTo?.[r.id];
      if (target) await tx.update(deal).set({ stageId: target }).where(eq(deal.stageId, r.id));
    }
    if (removed.length) {
      await tx.delete(pipelineStage).where(
        inArray(
          pipelineStage.id,
          removed.map((r) => r.id),
        ),
      );
    }
    await syncLegacy(tx, id);
  });
  await audit(actor, "pipeline.stages.replace", "pipeline", id, { stages: input.stages.length });
  return getPipeline(actor, id);
}

export async function deletePipeline(
  actor: Actor,
  id: string,
  input: z.infer<typeof pipelineDeleteSchema>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await findPipeline(tx, actor.organizationId, id);
    const others = await tx
      .select()
      .from(pipeline)
      .where(and(eq(pipeline.organizationId, actor.organizationId), sql`${pipeline.id} <> ${id}`))
      .orderBy(asc(pipeline.createdAt));
    if (!others.length) throw new HttpError(422, "Keep at least one pipeline. Create another one first.");
    const [{ n }] = await tx.select({ n: count() }).from(deal).where(eq(deal.pipelineId, id));
    if (n > 0) {
      const target = others.find((o) => o.id === input.moveDealsToPipelineId);
      if (!target) {
        throw new HttpError(422, "Some fields are invalid.", [
          {
            path: "moveDealsToPipelineId",
            message: `This pipeline has ${n} ${n === 1 ? "deal" : "deals"}. Choose a pipeline to move them to.`,
          },
        ]);
      }
      // Each deal keeps its outcome: open deals go to the first open stage, won/lost to the matching stage.
      const fromStages = await stagesOf(tx, id);
      const toStages = await stagesOf(tx, target.id);
      const toMap = legacyMap(toStages);
      const firstOpen = toStages.find((s) => s.type === "open");
      for (const s of fromStages) {
        const dest = s.type === "open" ? firstOpen : toStages.find((t) => t.type === s.type);
        if (!dest) continue;
        await tx
          .update(deal)
          .set({ pipelineId: target.id, stageId: dest.id, stage: toMap.get(dest.id) ?? "qualify" })
          .where(eq(deal.stageId, s.id));
      }
      await tx
        .update(deal)
        .set({ pipelineId: target.id, stageId: firstOpen?.id ?? null })
        .where(eq(deal.pipelineId, id));
    }
    await tx.delete(pipeline).where(eq(pipeline.id, id));
    if (row.isDefault) await tx.update(pipeline).set({ isDefault: true }).where(eq(pipeline.id, others[0].id));
  });
  await audit(actor, "pipeline.delete", "pipeline", id, { movedTo: input.moveDealsToPipelineId ?? null });
}

/** Resolve pipeline + stage for a deal write. Ids outside the workspace are a 422 on the field. */
export async function resolveDealStage(
  organizationId: string,
  input: { pipelineId?: string | null; stageId?: string | null; stage?: DealStage },
  current?: { pipelineId: string | null; stageId: string | null },
): Promise<{ pipelineId: string; stageId: string; legacy: DealStage; type: PipelineStageType; name: string }> {
  await ensureDefaultPipeline(organizationId);
  const invalid = (path: string, message: string) =>
    new HttpError(422, "Some fields are invalid.", [{ path, message }]);
  let pipelineId = input.pipelineId ?? null;
  if (pipelineId) {
    const [row] = await db
      .select({ id: pipeline.id })
      .from(pipeline)
      .where(and(eq(pipeline.organizationId, organizationId), eq(pipeline.id, pipelineId)))
      .limit(1);
    if (!row) throw invalid("pipelineId", "Pipeline not found.");
  }
  if (input.stageId) {
    const [row] = await db
      .select({ id: pipelineStage.id, pipelineId: pipelineStage.pipelineId })
      .from(pipelineStage)
      .innerJoin(pipeline, eq(pipeline.id, pipelineStage.pipelineId))
      .where(and(eq(pipeline.organizationId, organizationId), eq(pipelineStage.id, input.stageId)))
      .limit(1);
    if (!row) throw invalid("stageId", "Stage not found.");
    if (pipelineId && row.pipelineId !== pipelineId)
      throw invalid("stageId", "That stage belongs to another pipeline.");
    pipelineId = row.pipelineId;
  }
  pipelineId ??= current?.pipelineId ?? (await defaultPipelineId(organizationId));
  const stages = await stagesOf(db, pipelineId);
  const map = legacyMap(stages);
  let stageId = input.stageId ?? null;
  if (!stageId && input.stage) stageId = stageForLegacy(stages, input.stage);
  if (!stageId && current?.stageId && current.pipelineId === pipelineId) stageId = current.stageId;
  stageId ??= stages.find((s) => s.type === "open")?.id ?? stages[0]?.id ?? null;
  const chosen = stages.find((s) => s.id === stageId);
  if (!chosen) throw invalid("stageId", "This pipeline has no stages.");
  return {
    pipelineId,
    stageId: chosen.id,
    legacy: map.get(chosen.id) ?? "qualify",
    type: chosen.type,
    name: chosen.name,
  };
}
