import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { defaultRecordStages, type RecordStageEntity, type RecordStageView } from "@/lib/record-stages";
import { COMPANY_STAGES, CONTACT_STAGES } from "@/lib/records-vocabulary";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";

import { audit } from "./audit";

const { recordStage } = schema;

/** Workspace stages for contacts or accounts, seeded from the defaults on first read. */
export async function listRecordStages(
  organizationId: string,
  entityType: RecordStageEntity,
): Promise<RecordStageView[]> {
  const read = () =>
    db
      .select()
      .from(recordStage)
      .where(and(eq(recordStage.organizationId, organizationId), eq(recordStage.entityType, entityType)))
      .orderBy(asc(recordStage.position), asc(recordStage.key));
  let rows = await read();
  const defaults = defaultRecordStages(entityType);
  if (rows.length < defaults.length) {
    await db
      .insert(recordStage)
      .values(defaults.map((d) => ({ organizationId, entityType, ...d })))
      .onConflictDoNothing();
    rows = await read();
  }
  return rows.map((r) => ({ key: r.key, label: r.label, position: r.position, protected: r.protected }));
}

/** key → label for a workspace (used wherever stages show). */
export async function stageLabels(
  organizationId: string,
  entityType: RecordStageEntity,
): Promise<Record<string, string>> {
  return Object.fromEntries((await listRecordStages(organizationId, entityType)).map((s) => [s.key, s.label]));
}

/** Server-side label lookup: `await stageLabel(orgId, "new")` → "Cold" (or the workspace's own name). */
export async function stageLabel(organizationId: string, key: string, entityType: RecordStageEntity = "contact") {
  return (await stageLabels(organizationId, entityType))[key] ?? key;
}

export const recordStagesUpdateSchema = z
  .object({
    entityType: z.enum(["contact", "company"]).default("contact"),
    stages: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(40),
            label: z.string().trim().min(1, "Name every stage.").max(40),
            protected: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();

/** Rename, reorder and protect stages. The list must hold every stage key exactly once. */
export async function updateRecordStages(actor: Actor, input: z.infer<typeof recordStagesUpdateSchema>) {
  const keys: readonly string[] = input.entityType === "contact" ? CONTACT_STAGES : COMPANY_STAGES;
  const issues: { path: string; message: string }[] = [];
  input.stages.forEach((s, i) => {
    if (!keys.includes(s.key)) {
      issues.push({ path: `stages.${i}.key`, message: "Custom stages aren't available yet. Rename an existing one." });
    }
  });
  const given = input.stages.map((s) => s.key);
  if (new Set(given).size !== given.length)
    issues.push({ path: "stages", message: "Each stage may appear only once." });
  const missing = keys.filter((k) => !given.includes(k));
  if (missing.length) issues.push({ path: "stages", message: `Include every stage (missing: ${missing.join(", ")}).` });
  const labels = input.stages.map((s) => s.label.toLowerCase());
  if (new Set(labels).size !== labels.length)
    issues.push({ path: "stages", message: "Give each stage a different name." });
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);

  await listRecordStages(actor.organizationId, input.entityType);
  await db.transaction(async (tx) => {
    for (const [position, s] of input.stages.entries()) {
      await tx
        .update(recordStage)
        .set({ label: s.label, position, protected: input.entityType === "contact" ? s.protected : false })
        .where(
          and(
            eq(recordStage.organizationId, actor.organizationId),
            eq(recordStage.entityType, input.entityType),
            eq(recordStage.key, s.key),
          ),
        );
    }
  });
  await audit(actor, "record_stages.update", "record_stage", null, { entityType: input.entityType });
  return listRecordStages(actor.organizationId, input.entityType);
}

/** Apollo-shaped list for `GET /contact_stages` and `GET /account_stages`. */
export async function apolloStageList(organizationId: string, entityType: RecordStageEntity) {
  const stages = await listRecordStages(organizationId, entityType);
  return stages.map((s) => ({
    id: s.key,
    name: s.key,
    displayName: s.label,
    displayOrder: s.position + 1,
    protected: s.protected,
  }));
}
