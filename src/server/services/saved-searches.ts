import "server-only";

import { and, desc, eq, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";

import { audit } from "./audit";
import {
  type CompanyFilters,
  companyFilterSchema,
  normalizeFilterInput,
  type PeopleFilters,
  peopleFilterSchema,
  resolveFilterContext,
} from "./search-filters";
import { assertWorkspaceMember } from "./workspace-refs";

/**
 * Saved searches (people and companies): named filter sets with columns and sort. Visible to the
 * owner, to everyone in the workspace when shared, and to the person they're assigned to. Only the
 * owner edits or deletes; anyone who can see one may star it.
 */

const { savedSearch, user } = schema;
const owner = alias(user, "owner");
const assignee = alias(user, "assignee");

export const SAVED_SEARCH_TABS = ["all", "mine", "starred", "assigned", "shared"] as const;

const columnsSchema = z.array(z.string().trim().min(1).max(64)).max(60);
const sortSchema = z.object({ field: z.string().trim().min(1).max(64), ascending: z.boolean() }).nullable();

const base = {
  name: z.string().trim().min(1, "Name the search.").max(120, "Keep the name under 120 characters."),
  filters: z.record(z.string(), z.unknown()),
  columns: columnsSchema.nullable(),
  sort: sortSchema,
  starred: z.boolean(),
  shared: z.boolean(),
  alertsEnabled: z.boolean(),
  assignedToId: z.string().trim().min(1).max(128).nullable(),
};

export const savedSearchCreateSchema = z
  .object({
    name: base.name,
    entityType: z.enum(["contact", "company"]),
    filters: base.filters.default({}),
    columns: base.columns.optional(),
    sort: base.sort.optional(),
    starred: base.starred.optional(),
    shared: base.shared.optional(),
    alertsEnabled: base.alertsEnabled.optional(),
    assignedToId: base.assignedToId.optional(),
  })
  .strict();

export const savedSearchUpdateSchema = z
  .object({
    name: base.name.optional(),
    filters: base.filters.optional(),
    columns: base.columns.optional(),
    sort: base.sort.optional(),
    starred: base.starred.optional(),
    shared: base.shared.optional(),
    alertsEnabled: base.alertsEnabled.optional(),
    assignedToId: base.assignedToId.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

export const savedSearchListQuery = z.object({
  entityType: z.enum(["contact", "company"]).optional(),
  tab: z.enum(SAVED_SEARCH_TABS).optional(),
});

export interface SavedSearchDto {
  id: string;
  name: string;
  entityType: "contact" | "company";
  filters: Record<string, unknown>;
  columns: string[] | null;
  sort: { field: string; ascending: boolean } | null;
  starred: boolean;
  shared: boolean;
  alertsEnabled: boolean;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  assignedToId: string | null;
  assignedTo: { id: string; name: string } | null;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

function selectQuery() {
  return db
    .select({
      row: savedSearch,
      ownerName: owner.name,
      assigneeName: assignee.name,
    })
    .from(savedSearch)
    .leftJoin(owner, eq(owner.id, savedSearch.ownerId))
    .leftJoin(assignee, eq(assignee.id, savedSearch.assignedToId));
}

type Joined = Awaited<ReturnType<typeof selectQuery>>[number];

function toDto(actor: Actor, r: Joined): SavedSearchDto {
  const s = r.row;
  return {
    id: s.id,
    name: s.name,
    entityType: s.entityType,
    filters: s.filters,
    columns: s.columns,
    sort: s.sort ?? null,
    starred: s.starred,
    shared: s.shared,
    alertsEnabled: s.alertsEnabled,
    ownerId: s.ownerId,
    owner: s.ownerId && r.ownerName ? { id: s.ownerId, name: r.ownerName } : null,
    assignedToId: s.assignedToId,
    assignedTo: s.assignedToId && r.assigneeName ? { id: s.assignedToId, name: r.assigneeName } : null,
    isOwner: Boolean(actor.userId && s.ownerId === actor.userId),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** What the actor may see: own, shared, or assigned to them. API keys see shared ones only. */
function visible(actor: Actor): SQL {
  const conds: SQL[] = [eq(savedSearch.shared, true)];
  if (actor.userId) {
    conds.push(eq(savedSearch.ownerId, actor.userId), eq(savedSearch.assignedToId, actor.userId));
  }
  return and(eq(savedSearch.organizationId, actor.organizationId), or(...conds)) as SQL;
}

/** Validate filters with the entity's schema and check referenced ids are in the workspace. */
async function cleanFilters(
  actor: Actor,
  entityType: "contact" | "company",
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const input = normalizeFilterInput(raw);
  const parsed: PeopleFilters | CompanyFilters =
    entityType === "contact" ? peopleFilterSchema.parse(input) : companyFilterSchema.parse(input);
  await resolveFilterContext(actor, entityType, parsed);
  return Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)),
  );
}

export async function listSavedSearches(
  actor: Actor,
  query: z.infer<typeof savedSearchListQuery> = {},
): Promise<SavedSearchDto[]> {
  const conds: (SQL | undefined)[] = [visible(actor)];
  if (query.entityType) conds.push(eq(savedSearch.entityType, query.entityType));
  switch (query.tab) {
    case "mine":
      conds.push(actor.userId ? eq(savedSearch.ownerId, actor.userId) : undefined);
      break;
    case "starred":
      conds.push(eq(savedSearch.starred, true));
      break;
    case "assigned":
      conds.push(actor.userId ? eq(savedSearch.assignedToId, actor.userId) : eq(savedSearch.id, ""));
      break;
    case "shared":
      conds.push(eq(savedSearch.shared, true));
      break;
    default:
      break;
  }
  const rows = await selectQuery()
    .where(and(...conds))
    .orderBy(desc(savedSearch.starred), desc(savedSearch.updatedAt))
    .limit(200);
  return rows.map((r) => toDto(actor, r));
}

async function findVisible(actor: Actor, id: string): Promise<Joined> {
  const [row] = await selectQuery()
    .where(and(visible(actor), eq(savedSearch.id, id)))
    .limit(1);
  if (!row) throw notFound("Saved search not found.");
  return row;
}

export async function getSavedSearch(actor: Actor, id: string): Promise<SavedSearchDto> {
  return toDto(actor, await findVisible(actor, id));
}

export async function createSavedSearch(
  actor: Actor,
  input: z.infer<typeof savedSearchCreateSchema>,
): Promise<SavedSearchDto> {
  const filters = await cleanFilters(actor, input.entityType, input.filters);
  if (input.assignedToId) await assertWorkspaceMember(actor, input.assignedToId, "assignedToId");
  const [row] = await db
    .insert(savedSearch)
    .values({
      organizationId: actor.organizationId,
      ownerId: actor.userId,
      name: input.name,
      entityType: input.entityType,
      filters,
      columns: input.columns ?? null,
      sort: input.sort ?? null,
      starred: input.starred ?? false,
      shared: input.shared ?? false,
      alertsEnabled: input.alertsEnabled ?? false,
      assignedToId: input.assignedToId ?? null,
    })
    .returning({ id: savedSearch.id });
  await audit(actor, "saved_search.create", "saved_search", row.id, { name: input.name, entityType: input.entityType });
  return getSavedSearch(actor, row.id);
}

export async function updateSavedSearch(
  actor: Actor,
  id: string,
  input: z.infer<typeof savedSearchUpdateSchema>,
): Promise<SavedSearchDto> {
  const current = await findVisible(actor, id);
  const isOwner = Boolean(actor.userId && current.row.ownerId === actor.userId);
  const onlyStar = Object.entries(input).every(([k, v]) => k === "starred" || v === undefined);
  if (!isOwner && !onlyStar) throw forbidden("Only the person who saved this search can change it.");
  const patch: Partial<typeof savedSearch.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.filters !== undefined) patch.filters = await cleanFilters(actor, current.row.entityType, input.filters);
  if (input.columns !== undefined) patch.columns = input.columns;
  if (input.sort !== undefined) patch.sort = input.sort;
  if (input.starred !== undefined) patch.starred = input.starred;
  if (input.shared !== undefined) patch.shared = input.shared;
  if (input.alertsEnabled !== undefined) patch.alertsEnabled = input.alertsEnabled;
  if (input.assignedToId !== undefined) {
    if (input.assignedToId) await assertWorkspaceMember(actor, input.assignedToId, "assignedToId");
    patch.assignedToId = input.assignedToId;
  }
  await db
    .update(savedSearch)
    .set(patch)
    .where(and(eq(savedSearch.organizationId, actor.organizationId), eq(savedSearch.id, id)));
  await audit(actor, "saved_search.update", "saved_search", id, { fields: Object.keys(patch) });
  return getSavedSearch(actor, id);
}

export async function deleteSavedSearch(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const current = await findVisible(actor, id);
  if (!actor.userId || current.row.ownerId !== actor.userId) {
    throw forbidden("Only the person who saved this search can delete it.");
  }
  await db.delete(savedSearch).where(and(eq(savedSearch.organizationId, actor.organizationId), eq(savedSearch.id, id)));
  await audit(actor, "saved_search.delete", "saved_search", id, { name: current.row.name });
  return { id, deleted: true };
}
