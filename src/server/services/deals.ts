import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, notInArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { PipelineStageType } from "@/lib/deal-pipelines";
import { DEAL_STAGE_INFO, DEAL_STAGES, type DealStage } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import { recordEvent } from "./events";
import { ensureDefaultPipeline, resolveDealStage } from "./pipelines";
import { type ImportPayload, type ImportReport, mapCsv, normalizeDomain, normalizeEmail } from "./records";
import { assertCompanyInScope, assertWorkspaceMember, contactInScope, dateInput, refId } from "./workspace-refs";

export type { DealStage };
export { DEAL_STAGE_INFO, DEAL_STAGES };

export function dealStages() {
  return DEAL_STAGES.map((id, index) => ({
    id,
    name: DEAL_STAGE_INFO[id].name,
    display_order: index,
    probability: DEAL_STAGE_INFO[id].probability,
    is_won: DEAL_STAGE_INFO[id].isWon,
    is_closed: DEAL_STAGE_INFO[id].isClosed,
    description: DEAL_STAGE_INFO[id].description,
  }));
}

/** Whole currency units; accepts a number or a numeric string without separators (Apollo style). */
const amountInput = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "Use digits only, e.g. 12000."),
  ])
  .transform((v) => Math.round(Number(v)))
  .pipe(z.number().int().min(0).max(2_000_000_000));

const currencyInput = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code, e.g. USD.")
  .transform((v) => v.toUpperCase());

const customFieldValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const customFieldsInput = z.record(z.string().max(64), customFieldValue);

const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.union([item, z.array(item).min(1).max(50)]).transform((v) => (Array.isArray(v) ? v : [v]) as z.infer<T>[]);

const numberish = z.union([z.number(), z.string().trim().regex(/^\d+$/)]).transform(Number);

export const dealSearchSchema = z.object({
  stage: oneOrMany(z.enum(DEAL_STAGES)).optional(),
  /** Only stages that are not won or lost. */
  open: z.boolean().optional(),
  mine: z.boolean().optional(),
  ownerId: refId.optional(),
  ownerIds: oneOrMany(refId).optional(),
  contactId: refId.optional(),
  companyId: refId.optional(),
  pipelineId: refId.optional(),
  stageIds: oneOrMany(refId).optional(),
  closeDateFrom: dateInput.optional(),
  closeDateTo: dateInput.optional(),
  amountMin: numberish.optional(),
  amountMax: numberish.optional(),
  /** Company name contains (case-insensitive). */
  companyName: z.string().trim().max(200).optional(),
  q: z.string().trim().max(200).optional(),
  sort_by_field: z.enum(["amount", "close_date", "created_at", "name"]).optional(),
  sort_ascending: z.boolean().optional(),
  page: z.union([z.number(), z.string()]).optional(),
  per_page: z.union([z.number(), z.string()]).optional(),
});

export const dealCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  stage: z.enum(DEAL_STAGES).optional(),
  pipelineId: refId.optional(),
  stageId: refId.optional(),
  amount: amountInput.nullable().optional(),
  currency: currencyInput.optional(),
  closeDate: dateInput.nullable().optional(),
  ownerId: refId.nullable().optional(),
  companyId: refId.nullable().optional(),
  contactId: refId.nullable().optional(),
  customFields: customFieldsInput.optional(),
});

export const dealUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    stage: z.enum(DEAL_STAGES).optional(),
    pipelineId: refId.optional(),
    stageId: refId.optional(),
    amount: amountInput.nullable().optional(),
    currency: currencyInput.optional(),
    closeDate: dateInput.nullable().optional(),
    ownerId: refId.nullable().optional(),
    companyId: refId.nullable().optional(),
    contactId: refId.nullable().optional(),
    customFields: customFieldsInput.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

const owner = alias(schema.user, "deal_owner");

const dealColumns = {
  id: schema.deal.id,
  name: schema.deal.name,
  stage: schema.deal.stage,
  pipelineId: schema.deal.pipelineId,
  stageId: schema.deal.stageId,
  stageName: schema.pipelineStage.name,
  stageType: schema.pipelineStage.type,
  stageProbability: schema.pipelineStage.probability,
  pipelineName: schema.pipeline.name,
  customFields: schema.deal.customFields,
  amount: schema.deal.amount,
  currency: schema.deal.currency,
  closeDate: schema.deal.closeDate,
  createdAt: schema.deal.createdAt,
  updatedAt: schema.deal.updatedAt,
  ownerId: schema.deal.ownerId,
  ownerName: owner.name,
  ownerEmail: owner.email,
  companyId: schema.deal.companyId,
  companyName: schema.company.name,
  companyDomain: schema.company.domain,
  contactId: schema.deal.contactId,
  contactFirstName: schema.contact.firstName,
  contactLastName: schema.contact.lastName,
  contactEmail: schema.contact.email,
};

function baseQuery() {
  return db
    .select(dealColumns)
    .from(schema.deal)
    .leftJoin(owner, eq(owner.id, schema.deal.ownerId))
    .leftJoin(schema.company, eq(schema.company.id, schema.deal.companyId))
    .leftJoin(schema.contact, eq(schema.contact.id, schema.deal.contactId))
    .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.deal.stageId))
    .leftJoin(schema.pipeline, eq(schema.pipeline.id, schema.deal.pipelineId));
}

type DealRow = Awaited<ReturnType<typeof baseQuery>>[number];

export interface DealDto {
  id: string;
  name: string;
  /** Closest legacy stage (qualify / meeting / proposal / negotiation / won / lost). */
  stage: DealStage;
  pipelineId: string | null;
  pipelineName: string | null;
  stageId: string | null;
  stageName: string;
  stageType: PipelineStageType;
  probability: number | null;
  amount: number | null;
  currency: string;
  closeDate: string | null;
  createdAt: string;
  updatedAt: string;
  isClosed: boolean;
  isWon: boolean;
  customFields: Record<string, unknown>;
  owner: { id: string; name: string; email: string } | null;
  company: { id: string; name: string; domain: string | null } | null;
  contact: { id: string; name: string; email: string | null } | null;
}

function legacyType(stage: DealStage): PipelineStageType {
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return "open";
}

function toDto(row: DealRow): DealDto {
  const contactName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ");
  const stageType = row.stageType ?? legacyType(row.stage);
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    pipelineId: row.pipelineId,
    pipelineName: row.pipelineName,
    stageId: row.stageId,
    stageName: row.stageName ?? DEAL_STAGE_INFO[row.stage].name,
    stageType,
    probability: row.stageProbability ?? DEAL_STAGE_INFO[row.stage].probability,
    amount: row.amount,
    currency: row.currency,
    closeDate: row.closeDate?.toISOString().slice(0, 10) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isClosed: stageType !== "open",
    isWon: stageType === "won",
    customFields: row.customFields ?? {},
    owner:
      row.ownerId && row.ownerName && row.ownerEmail
        ? { id: row.ownerId, name: row.ownerName, email: row.ownerEmail }
        : null,
    company:
      row.companyId && row.companyName ? { id: row.companyId, name: row.companyName, domain: row.companyDomain } : null,
    contact: row.contactId
      ? { id: row.contactId, name: contactName || row.contactEmail || "Unnamed contact", email: row.contactEmail }
      : null,
  };
}

export interface StageTotal {
  stage: DealStage;
  name: string;
  count: number;
  amount: number;
}

export interface PipelineStageTotal {
  stageId: string;
  count: number;
  amount: number;
}

export async function stageTotals(actor: Actor, extra?: SQL): Promise<StageTotal[]> {
  const rows = await db
    .select({
      stage: schema.deal.stage,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${schema.deal.amount}), 0)::bigint`,
    })
    .from(schema.deal)
    .where(and(eq(schema.deal.organizationId, actor.organizationId), extra))
    .groupBy(schema.deal.stage);
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  return DEAL_STAGES.map((stage) => ({
    stage,
    name: DEAL_STAGE_INFO[stage].name,
    count: byStage.get(stage)?.count ?? 0,
    amount: Number(byStage.get(stage)?.amount ?? 0),
  }));
}

async function pipelineStageTotals(actor: Actor, extra?: SQL): Promise<PipelineStageTotal[]> {
  const rows = await db
    .select({
      stageId: schema.deal.stageId,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${schema.deal.amount}), 0)::bigint`,
    })
    .from(schema.deal)
    .where(and(eq(schema.deal.organizationId, actor.organizationId), extra))
    .groupBy(schema.deal.stageId);
  return rows.flatMap((r) => (r.stageId ? [{ stageId: r.stageId, count: r.count, amount: Number(r.amount) }] : []));
}

export type DealSearch = z.infer<typeof dealSearchSchema>;

export async function searchDeals(actor: Actor, input: DealSearch, page: Page) {
  await ensureDefaultPipeline(actor.organizationId);
  const where: SQL[] = [eq(schema.deal.organizationId, actor.organizationId)];
  if (input.mine) {
    if (!actor.userId) {
      return { deals: [] as DealDto[], total: 0, totals: await stageTotals(actor, sql`false`), pipelineTotals: [] };
    }
    where.push(eq(schema.deal.ownerId, actor.userId));
  }
  if (input.stage) where.push(inArray(schema.deal.stage, input.stage));
  if (input.open) where.push(notInArray(schema.deal.stage, ["won", "lost"]));
  if (input.ownerId) where.push(eq(schema.deal.ownerId, input.ownerId));
  if (input.ownerIds) where.push(inArray(schema.deal.ownerId, input.ownerIds));
  if (input.contactId) where.push(eq(schema.deal.contactId, input.contactId));
  if (input.companyId) where.push(eq(schema.deal.companyId, input.companyId));
  if (input.pipelineId) where.push(eq(schema.deal.pipelineId, input.pipelineId));
  if (input.stageIds) where.push(inArray(schema.deal.stageId, input.stageIds));
  if (input.closeDateFrom) where.push(gte(schema.deal.closeDate, input.closeDateFrom));
  if (input.closeDateTo) where.push(lte(schema.deal.closeDate, input.closeDateTo));
  if (input.amountMin !== undefined) where.push(gte(schema.deal.amount, input.amountMin));
  if (input.amountMax !== undefined) where.push(lte(schema.deal.amount, input.amountMax));
  if (input.q) where.push(ilike(schema.deal.name, `%${input.q.replace(/[%_\\]/g, "\\$&")}%`));
  if (input.companyName) {
    const pattern = `%${input.companyName.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      sql`exists (select 1 from ${schema.company} where ${schema.company.id} = ${schema.deal.companyId} and ${schema.company.name} ilike ${pattern})`,
    );
  }
  const condition = and(...where);

  const asc_ = input.sort_ascending === true;
  const orders: Record<string, SQL[]> = {
    amount: [asc_ ? sql`${schema.deal.amount} asc nulls last` : sql`${schema.deal.amount} desc nulls last`],
    close_date: [
      asc_ || input.sort_ascending === undefined
        ? sql`${schema.deal.closeDate} asc nulls last`
        : sql`${schema.deal.closeDate} desc nulls last`,
    ],
    name: [asc(schema.deal.name)],
    created_at: [asc_ ? asc(schema.deal.createdAt) : desc(schema.deal.createdAt)],
  };
  const order = orders[input.sort_by_field ?? ""] ?? [desc(schema.deal.createdAt)];

  const [rows, [{ count: total }], totals, pipelineTotals] = await Promise.all([
    baseQuery()
      .where(condition)
      .orderBy(...order, asc(schema.deal.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.deal).where(condition),
    stageTotals(actor, and(...where.slice(1))),
    pipelineStageTotals(actor, and(...where.slice(1))),
  ]);
  return { deals: rows.map(toDto), total, totals, pipelineTotals };
}

export async function getDeal(actor: Pick<Actor, "organizationId">, id: string): Promise<DealDto> {
  const [row] = await baseQuery()
    .where(and(eq(schema.deal.organizationId, actor.organizationId), eq(schema.deal.id, id)))
    .limit(1);
  if (!row) throw notFound("Deal not found.");
  return toDto(row);
}

async function checkRefs(
  actor: Actor,
  input: { ownerId?: string | null; companyId?: string | null; contactId?: string | null },
) {
  if (input.ownerId) await assertWorkspaceMember(actor, input.ownerId, "ownerId");
  if (input.companyId) await assertCompanyInScope(actor, input.companyId, "companyId");
  if (input.contactId) return contactInScope(actor, input.contactId, "contactId");
  return null;
}

/** Check custom field values against the workspace's deal fields (settings → custom fields). */
async function checkCustomFields(
  organizationId: string,
  values: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!values) return undefined;
  const defs = await db
    .select()
    .from(schema.customField)
    .where(and(eq(schema.customField.organizationId, organizationId), eq(schema.customField.entityType, "deal")));
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const issues: { path: string; message: string }[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const def = byKey.get(key);
    const path = `customFields.${key}`;
    if (!def) {
      issues.push({ path, message: "There's no deal field with this key." });
      continue;
    }
    if (value === null || value === "") {
      out[key] = null;
      continue;
    }
    switch (def.type) {
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) issues.push({ path, message: `${def.label} must be a number.` });
        else out[key] = n;
        break;
      }
      case "boolean":
        if (typeof value === "boolean") out[key] = value;
        else if (value === "true" || value === "false") out[key] = value === "true";
        else issues.push({ path, message: `${def.label} must be true or false.` });
        break;
      case "date":
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
          issues.push({ path, message: `${def.label} must be a date, e.g. 2026-10-31.` });
        } else out[key] = value.slice(0, 10);
        break;
      case "picklist":
        if (typeof value !== "string" || !(def.options ?? []).includes(value)) {
          issues.push({ path, message: `Pick one of the options for ${def.label}.` });
        } else out[key] = value;
        break;
      case "url":
        if (typeof value !== "string" || !/^https?:\/\/\S+$/i.test(value)) {
          issues.push({ path, message: `${def.label} must be a web address starting with http:// or https://.` });
        } else out[key] = value;
        break;
      default:
        out[key] = String(value);
    }
  }
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);
  return out;
}

export async function createDeal(actor: Actor, input: z.infer<typeof dealCreateSchema>): Promise<DealDto> {
  const ownerId = input.ownerId === undefined ? actor.userId : input.ownerId;
  const contact = await checkRefs(actor, { ...input, ownerId });
  const placed = await resolveDealStage(actor.organizationId, input);
  const customFields = await checkCustomFields(actor.organizationId, input.customFields);
  const companyId = input.companyId ?? contact?.companyId ?? null;
  const [created] = await db
    .insert(schema.deal)
    .values({
      organizationId: actor.organizationId,
      name: input.name,
      stage: placed.legacy,
      pipelineId: placed.pipelineId,
      stageId: placed.stageId,
      customFields: customFields ?? {},
      amount: input.amount ?? null,
      currency: input.currency ?? "USD",
      closeDate: input.closeDate ?? null,
      ownerId: ownerId ?? null,
      companyId,
      contactId: input.contactId ?? null,
    })
    .returning({ id: schema.deal.id });
  await audit(actor, "deal.create", "deal", created.id, {
    stage: placed.legacy,
    stageId: placed.stageId,
    amount: input.amount ?? null,
  });
  await recordEvent({
    organizationId: actor.organizationId,
    type: "deal_created",
    summary: `Deal "${input.name}" created in ${placed.name}`,
    dealId: created.id,
    contactId: input.contactId ?? null,
    companyId,
    actorUserId: actor.userId,
    metadata: { stageId: placed.stageId, pipelineId: placed.pipelineId, stageType: placed.type },
  });
  return getDeal(actor, created.id);
}

export async function updateDeal(actor: Actor, id: string, input: z.infer<typeof dealUpdateSchema>): Promise<DealDto> {
  const current = await getDeal(actor, id);
  await checkRefs(actor, input);
  const stageChange = input.stage !== undefined || input.stageId !== undefined || input.pipelineId !== undefined;
  const placed = stageChange
    ? await resolveDealStage(actor.organizationId, input, { pipelineId: current.pipelineId, stageId: current.stageId })
    : null;
  const customFields = await checkCustomFields(actor.organizationId, input.customFields);
  await db
    .update(schema.deal)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(placed && { stage: placed.legacy, stageId: placed.stageId, pipelineId: placed.pipelineId }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.closeDate !== undefined && { closeDate: input.closeDate }),
      ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
      ...(input.companyId !== undefined && { companyId: input.companyId }),
      ...(input.contactId !== undefined && { contactId: input.contactId }),
      ...(customFields && { customFields: { ...current.customFields, ...customFields } }),
    })
    .where(and(eq(schema.deal.organizationId, actor.organizationId), eq(schema.deal.id, id)));
  const fields = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  const moved = placed && placed.stageId !== current.stageId;
  await audit(actor, "deal.update", "deal", id, {
    fields,
    ...(placed && placed.legacy !== current.stage ? { fromStage: current.stage, toStage: placed.legacy } : {}),
    ...(moved ? { fromStageId: current.stageId, toStageId: placed.stageId } : {}),
  });
  if (moved) {
    await recordEvent({
      organizationId: actor.organizationId,
      type: "deal_stage_changed",
      summary: `Moved from ${current.stageName} to ${placed.name}`,
      dealId: id,
      contactId: current.contact?.id ?? null,
      companyId: current.company?.id ?? null,
      actorUserId: actor.userId,
      metadata: {
        fromStageId: current.stageId,
        toStageId: placed.stageId,
        fromStage: current.stageName,
        toStage: placed.name,
        stageType: placed.type,
      },
    });
  }
  return getDeal(actor, id);
}

export async function deleteDeal(actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(schema.deal)
    .where(and(eq(schema.deal.organizationId, actor.organizationId), eq(schema.deal.id, id)))
    .returning({ id: schema.deal.id });
  if (!deleted.length) throw notFound("Deal not found.");
  await audit(actor, "deal.delete", "deal", id);
}

/** Deals linked to a contact. Unknown or out-of-scope contacts give an empty list (Apollo behaviour). */
export async function dealsForContact(actor: Actor, contactId: string): Promise<DealDto[]> {
  const rows = await baseQuery()
    .where(and(eq(schema.deal.organizationId, actor.organizationId), eq(schema.deal.contactId, contactId)))
    .orderBy(desc(schema.deal.createdAt));
  return rows.map(toDto);
}

/** Won deals since `since` (close date, else last update). */
export async function wonSince(actor: Actor, since: Date) {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${schema.deal.amount}), 0)::bigint`,
    })
    .from(schema.deal)
    .where(
      and(
        eq(schema.deal.organizationId, actor.organizationId),
        eq(schema.deal.stage, "won"),
        gte(sql`coalesce(${schema.deal.closeDate}, ${schema.deal.updatedAt})`, since),
      ),
    );
  return { count: row?.count ?? 0, amount: Number(row?.amount ?? 0) };
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                   */
/* -------------------------------------------------------------------------- */

export async function dealActivity(actor: Actor, id: string) {
  await getDeal(actor, id);
  const rows = await db
    .select({
      id: schema.activity.id,
      type: schema.activity.type,
      summary: schema.activity.summary,
      occurredAt: schema.activity.occurredAt,
      actorName: schema.user.name,
    })
    .from(schema.activity)
    .leftJoin(schema.user, eq(schema.user.id, schema.activity.actorUserId))
    .where(and(eq(schema.activity.organizationId, actor.organizationId), eq(schema.activity.dealId, id)))
    .orderBy(desc(schema.activity.occurredAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    summary: r.summary,
    occurredAt: r.occurredAt.toISOString(),
    actorName: r.actorName,
  }));
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

const TYPE_ORDER: Record<PipelineStageType, number> = { open: 0, won: 1, lost: 2 };

export const dealAnalyticsSchema = z.object({ pipelineId: refId.optional() });

export async function dealAnalytics(actor: Actor, input: z.infer<typeof dealAnalyticsSchema>) {
  await ensureDefaultPipeline(actor.organizationId);
  const scope = and(
    eq(schema.deal.organizationId, actor.organizationId),
    input.pipelineId ? eq(schema.deal.pipelineId, input.pipelineId) : undefined,
  );
  const typeOf = sql<PipelineStageType>`coalesce(${schema.pipelineStage.type}, case when ${schema.deal.stage} = 'won' then 'won' when ${schema.deal.stage} = 'lost' then 'lost' else 'open' end)`;
  const [byStage, [summary], monthly, byOwner] = await Promise.all([
    db
      .select({
        stageId: schema.deal.stageId,
        name: sql<string>`coalesce(${schema.pipelineStage.name}, ${schema.deal.stage})`,
        position: sql<number>`coalesce(${schema.pipelineStage.position}, 0)`,
        type: typeOf,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${schema.deal.amount}), 0)::bigint`,
      })
      .from(schema.deal)
      .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.deal.stageId))
      .where(scope)
      .groupBy(
        schema.deal.stageId,
        schema.pipelineStage.name,
        schema.pipelineStage.position,
        schema.pipelineStage.type,
        schema.deal.stage,
      ),
    db
      .select({
        total: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${typeOf} = 'won')::int`,
        lost: sql<number>`count(*) filter (where ${typeOf} = 'lost')::int`,
        wonAmount: sql<number>`coalesce(sum(${schema.deal.amount}) filter (where ${typeOf} = 'won'), 0)::bigint`,
        openAmount: sql<number>`coalesce(sum(${schema.deal.amount}) filter (where ${typeOf} = 'open'), 0)::bigint`,
        avgAmount: sql<number>`coalesce(avg(${schema.deal.amount}) filter (where ${schema.deal.amount} is not null), 0)::float`,
      })
      .from(schema.deal)
      .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.deal.stageId))
      .where(scope),
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${schema.deal.createdAt}), 'YYYY-MM')`,
        created: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${typeOf} = 'won')::int`,
      })
      .from(schema.deal)
      .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.deal.stageId))
      .where(and(scope, gte(schema.deal.createdAt, sql`date_trunc('month', now()) - interval '11 months'`)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        ownerId: schema.deal.ownerId,
        ownerName: schema.user.name,
        count: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${typeOf} = 'won')::int`,
        openAmount: sql<number>`coalesce(sum(${schema.deal.amount}) filter (where ${typeOf} = 'open'), 0)::bigint`,
        wonAmount: sql<number>`coalesce(sum(${schema.deal.amount}) filter (where ${typeOf} = 'won'), 0)::bigint`,
      })
      .from(schema.deal)
      .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.deal.stageId))
      .leftJoin(schema.user, eq(schema.user.id, schema.deal.ownerId))
      .where(scope)
      .groupBy(schema.deal.ownerId, schema.user.name)
      .orderBy(sql`count(*) desc`)
      .limit(25),
  ]);

  // Fill the last 12 months so charts have a continuous axis.
  const months: { month: string; created: number; won: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const found = monthly.find((m) => m.month === key);
    months.push({ month: key, created: found?.created ?? 0, won: found?.won ?? 0 });
  }
  const closed = (summary?.won ?? 0) + (summary?.lost ?? 0);
  return {
    totals: {
      deals: summary?.total ?? 0,
      won: summary?.won ?? 0,
      lost: summary?.lost ?? 0,
      winRate: closed ? (summary?.won ?? 0) / closed : null,
      averageDealSize: Math.round(Number(summary?.avgAmount ?? 0)),
      openPipeline: Number(summary?.openAmount ?? 0),
      wonAmount: Number(summary?.wonAmount ?? 0),
    },
    byStage: [...byStage]
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.position - b.position)
      .map((s) => ({
        stageId: s.stageId,
        name: s.stageId ? s.name : (DEAL_STAGE_INFO[s.name as DealStage]?.name ?? s.name),
        type: s.type,
        count: s.count,
        amount: Number(s.amount),
      })),
    byMonth: months,
    byOwner: byOwner.map((o) => ({
      ownerId: o.ownerId,
      name: o.ownerName ?? "No owner",
      count: o.count,
      won: o.won,
      openAmount: Number(o.openAmount),
      wonAmount: Number(o.wonAmount),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV import                                                                 */
/* -------------------------------------------------------------------------- */

const IMPORT_FIELDS = ["name", "companyDomain", "contactEmail", "amount", "stage", "closeDate", "ownerEmail"] as const;
const IMPORT_ALIASES: Record<string, string> = {
  name: "name",
  dealname: "name",
  deal: "name",
  opportunity: "name",
  companydomain: "companyDomain",
  domain: "companyDomain",
  companywebsite: "companyDomain",
  website: "companyDomain",
  contactemail: "contactEmail",
  email: "contactEmail",
  amount: "amount",
  value: "amount",
  dealvalue: "amount",
  stage: "stage",
  dealstage: "stage",
  closedate: "closeDate",
  estimatedclosedate: "closeDate",
  expectedclosedate: "closeDate",
  owner: "ownerEmail",
  owneremail: "ownerEmail",
};

/**
 * Import deals from CSV: name, company domain, contact email, amount, stage (a stage name of the
 * chosen pipeline or a legacy value), close date, owner email. Companies and contacts are matched
 * in the workspace, never created; rows that point at unknown ones are imported without the link.
 */
export async function importDeals(
  actor: Actor,
  payload: ImportPayload,
  options: { pipelineId?: string } = {},
): Promise<ImportReport> {
  const { columns, rows } = mapCsv(payload.csv, IMPORT_ALIASES, IMPORT_FIELDS, payload.mapping);
  if (!Object.values(columns).includes("name")) {
    throw new HttpError(422, "Some fields are invalid.", [
      { path: "file", message: "Add a column with the deal name." },
    ]);
  }
  const placedDefault = await resolveDealStage(actor.organizationId, { pipelineId: options.pipelineId });
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.pipelineId, placedDefault.pipelineId));
  const domains = [
    ...new Set(rows.flatMap((r) => (r.companyDomain ? [normalizeDomain(r.companyDomain) ?? ""] : []))),
  ].filter(Boolean);
  const emails = [...new Set(rows.flatMap((r) => (r.contactEmail ? [normalizeEmail(r.contactEmail)] : [])))];
  const owners = [...new Set(rows.flatMap((r) => (r.ownerEmail ? [normalizeEmail(r.ownerEmail)] : [])))];
  const [companies, contacts, members] = await Promise.all([
    domains.length
      ? db
          .select({ id: schema.company.id, domain: schema.company.domain })
          .from(schema.company)
          .where(and(eq(schema.company.organizationId, actor.organizationId), inArray(schema.company.domain, domains)))
      : [],
    emails.length
      ? db
          .select({ id: schema.contact.id, email: schema.contact.email, companyId: schema.contact.companyId })
          .from(schema.contact)
          .where(and(eq(schema.contact.organizationId, actor.organizationId), inArray(schema.contact.email, emails)))
      : [],
    owners.length
      ? db
          .select({ id: schema.user.id, email: schema.user.email })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(and(eq(schema.member.organizationId, actor.organizationId), inArray(schema.user.email, owners)))
      : [],
  ]);
  const companyBy = new Map(companies.map((c) => [c.domain, c.id]));
  const contactBy = new Map(contacts.map((c) => [c.email, c]));
  const ownerBy = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));
  const report: ImportReport = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [], columns };

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    if (!row.name) {
      report.skipped += 1;
      report.errors.push({ row: rowNumber, message: "The deal name is empty." });
      continue;
    }
    let amount: number | null = null;
    if (row.amount) {
      const n = Number(row.amount.replace(/[$€£,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: `"${row.amount}" isn't an amount.` });
        continue;
      }
      amount = Math.round(n);
    }
    let closeDate: Date | null = null;
    if (row.closeDate) {
      if (Number.isNaN(Date.parse(row.closeDate))) {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: `"${row.closeDate}" isn't a date. Use 2026-10-31.` });
        continue;
      }
      closeDate = new Date(row.closeDate);
    }
    let stageId = placedDefault.stageId;
    if (row.stage) {
      const wanted = row.stage.trim().toLowerCase();
      const byName = stages.find((s) => s.name.toLowerCase() === wanted);
      const legacy = DEAL_STAGES.find((s) => s === wanted || DEAL_STAGE_INFO[s].name.toLowerCase() === wanted);
      if (byName) stageId = byName.id;
      else if (legacy) {
        stageId = (
          await resolveDealStage(actor.organizationId, { pipelineId: placedDefault.pipelineId, stage: legacy })
        ).stageId;
      } else {
        report.skipped += 1;
        report.errors.push({ row: rowNumber, message: `"${row.stage}" isn't a stage of this pipeline.` });
        continue;
      }
    }
    const placed = await resolveDealStage(actor.organizationId, { pipelineId: placedDefault.pipelineId, stageId });
    const contact = row.contactEmail ? contactBy.get(normalizeEmail(row.contactEmail)) : undefined;
    const domain = row.companyDomain ? normalizeDomain(row.companyDomain) : null;
    const companyId = (domain ? companyBy.get(domain) : undefined) ?? contact?.companyId ?? null;
    const ownerId = row.ownerEmail ? (ownerBy.get(normalizeEmail(row.ownerEmail)) ?? null) : actor.userId;
    if (row.ownerEmail && !ownerId) {
      report.errors.push({ row: rowNumber, message: `${row.ownerEmail} isn't a member here; the deal has no owner.` });
    }
    const [created] = await db
      .insert(schema.deal)
      .values({
        organizationId: actor.organizationId,
        name: row.name.slice(0, 200),
        stage: placed.legacy,
        pipelineId: placed.pipelineId,
        stageId: placed.stageId,
        amount,
        closeDate,
        ownerId,
        companyId,
        contactId: contact?.id ?? null,
      })
      .returning({ id: schema.deal.id });
    report.created += 1;
    await recordEvent({
      organizationId: actor.organizationId,
      type: "deal_created",
      summary: `Deal "${row.name.slice(0, 200)}" imported into ${placed.name}`,
      dealId: created.id,
      contactId: contact?.id ?? null,
      companyId,
      actorUserId: actor.userId,
      metadata: {
        stageId: placed.stageId,
        pipelineId: placed.pipelineId,
        stageType: placed.type,
        source: "csv_import",
      },
    });
  }
  await audit(actor, "deal.import", "deal", null, { created: report.created, skipped: report.skipped });
  return report;
}

export async function dealCount(organizationId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.deal).where(eq(schema.deal.organizationId, organizationId));
  return row?.n ?? 0;
}
