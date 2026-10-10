import "server-only";

import { and, asc, desc, eq, gte, ilike, inArray, notInArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { DEAL_STAGE_INFO, DEAL_STAGES, type DealStage } from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
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

export const dealSearchSchema = z.object({
  stage: z
    .union([z.enum(DEAL_STAGES), z.array(z.enum(DEAL_STAGES)).min(1)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  /** Only stages that are not won or lost. */
  open: z.boolean().optional(),
  mine: z.boolean().optional(),
  ownerId: refId.optional(),
  contactId: refId.optional(),
  companyId: refId.optional(),
  q: z.string().trim().max(200).optional(),
  sort_by_field: z.enum(["amount", "close_date", "created_at", "name"]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
  per_page: z.union([z.number(), z.string()]).optional(),
});

export const dealCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  stage: z.enum(DEAL_STAGES).default("qualify"),
  amount: amountInput.nullable().optional(),
  currency: currencyInput.optional(),
  closeDate: dateInput.nullable().optional(),
  ownerId: refId.nullable().optional(),
  companyId: refId.nullable().optional(),
  contactId: refId.nullable().optional(),
});

export const dealUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    stage: z.enum(DEAL_STAGES).optional(),
    amount: amountInput.nullable().optional(),
    currency: currencyInput.optional(),
    closeDate: dateInput.nullable().optional(),
    ownerId: refId.nullable().optional(),
    companyId: refId.nullable().optional(),
    contactId: refId.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

const owner = alias(schema.user, "deal_owner");

const dealColumns = {
  id: schema.deal.id,
  name: schema.deal.name,
  stage: schema.deal.stage,
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
    .leftJoin(schema.contact, eq(schema.contact.id, schema.deal.contactId));
}

type DealRow = Awaited<ReturnType<typeof baseQuery>>[number];

export interface DealDto {
  id: string;
  name: string;
  stage: DealStage;
  amount: number | null;
  currency: string;
  closeDate: string | null;
  createdAt: string;
  updatedAt: string;
  isClosed: boolean;
  isWon: boolean;
  owner: { id: string; name: string; email: string } | null;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string; email: string | null } | null;
}

function toDto(row: DealRow): DealDto {
  const contactName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ");
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    closeDate: row.closeDate?.toISOString().slice(0, 10) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isClosed: DEAL_STAGE_INFO[row.stage].isClosed,
    isWon: DEAL_STAGE_INFO[row.stage].isWon,
    owner:
      row.ownerId && row.ownerName && row.ownerEmail
        ? { id: row.ownerId, name: row.ownerName, email: row.ownerEmail }
        : null,
    company: row.companyId && row.companyName ? { id: row.companyId, name: row.companyName } : null,
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

export type DealSearch = z.infer<typeof dealSearchSchema>;

export async function searchDeals(actor: Actor, input: DealSearch, page: Page) {
  const where: SQL[] = [eq(schema.deal.organizationId, actor.organizationId)];
  if (input.mine) {
    if (!actor.userId) return { deals: [] as DealDto[], total: 0, totals: await stageTotals(actor, sql`false`) };
    where.push(eq(schema.deal.ownerId, actor.userId));
  }
  if (input.stage) where.push(inArray(schema.deal.stage, input.stage));
  if (input.open) where.push(notInArray(schema.deal.stage, ["won", "lost"]));
  if (input.ownerId) where.push(eq(schema.deal.ownerId, input.ownerId));
  if (input.contactId) where.push(eq(schema.deal.contactId, input.contactId));
  if (input.companyId) where.push(eq(schema.deal.companyId, input.companyId));
  if (input.q) where.push(ilike(schema.deal.name, `%${input.q.replace(/[%_\\]/g, "\\$&")}%`));
  const condition = and(...where);

  const orders: Record<string, SQL[]> = {
    amount: [sql`${schema.deal.amount} desc nulls last`],
    close_date: [sql`${schema.deal.closeDate} asc nulls last`],
    name: [asc(schema.deal.name)],
  };
  const order = orders[input.sort_by_field ?? ""] ?? [desc(schema.deal.createdAt)];

  const [rows, [{ count }], totals] = await Promise.all([
    baseQuery()
      .where(condition)
      .orderBy(...order, asc(schema.deal.id))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.deal).where(condition),
    stageTotals(actor, and(...where.slice(1))),
  ]);
  return { deals: rows.map(toDto), total: count, totals };
}

export async function getDeal(actor: Actor, id: string): Promise<DealDto> {
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

export async function createDeal(actor: Actor, input: z.infer<typeof dealCreateSchema>): Promise<DealDto> {
  const ownerId = input.ownerId === undefined ? actor.userId : input.ownerId;
  const contact = await checkRefs(actor, { ...input, ownerId });
  const [created] = await db
    .insert(schema.deal)
    .values({
      organizationId: actor.organizationId,
      name: input.name,
      stage: input.stage,
      amount: input.amount ?? null,
      currency: input.currency ?? "USD",
      closeDate: input.closeDate ?? null,
      ownerId: ownerId ?? null,
      companyId: input.companyId ?? contact?.companyId ?? null,
      contactId: input.contactId ?? null,
    })
    .returning({ id: schema.deal.id });
  await audit(actor, "deal.create", "deal", created.id, { stage: input.stage, amount: input.amount ?? null });
  return getDeal(actor, created.id);
}

export async function updateDeal(actor: Actor, id: string, input: z.infer<typeof dealUpdateSchema>): Promise<DealDto> {
  const current = await getDeal(actor, id);
  await checkRefs(actor, input);
  await db
    .update(schema.deal)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.stage !== undefined && { stage: input.stage }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.closeDate !== undefined && { closeDate: input.closeDate }),
      ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
      ...(input.companyId !== undefined && { companyId: input.companyId }),
      ...(input.contactId !== undefined && { contactId: input.contactId }),
    })
    .where(and(eq(schema.deal.organizationId, actor.organizationId), eq(schema.deal.id, id)));
  const fields = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  await audit(actor, "deal.update", "deal", id, {
    fields,
    ...(input.stage && input.stage !== current.stage ? { fromStage: current.stage, toStage: input.stage } : {}),
  });
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
