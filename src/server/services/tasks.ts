import "server-only";

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "@/lib/pipeline-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";

import { audit } from "./audit";
import {
  assertCompanyInScope,
  assertWorkspaceMember,
  contactInScope,
  contactsInScope,
  dateInput,
  invalidReference,
  refId,
} from "./workspace-refs";

export type { TaskPriority, TaskStatus, TaskType };
export { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES };

const oneOrMany = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.array(z.enum(values)).min(1)]).transform((v) => (Array.isArray(v) ? v : [v]));

export const taskSearchSchema = z.object({
  /** Only tasks assigned to the acting user. */
  mine: z.boolean().optional(),
  assigneeId: refId.optional(),
  status: oneOrMany(TASK_STATUSES).optional(),
  type: oneOrMany(TASK_TYPES).optional(),
  priority: oneOrMany(TASK_PRIORITIES).optional(),
  contactId: refId.optional(),
  companyId: refId.optional(),
  dueAfter: dateInput.optional(),
  dueBefore: dateInput.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["due_at", "priority", "created_at"]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
  per_page: z.union([z.number(), z.string()]).optional(),
});

const taskFields = {
  title: z.string().trim().min(1).max(200),
  type: z.enum(TASK_TYPES),
  priority: z.enum(TASK_PRIORITIES),
  assigneeId: refId,
  contactId: refId.nullable(),
  companyId: refId.nullable(),
  note: z.string().trim().max(5000).nullable(),
  dueAt: dateInput.nullable(),
};

export const taskCreateSchema = z.object({
  title: taskFields.title.optional(),
  type: taskFields.type.default("action_item"),
  priority: taskFields.priority.default("medium"),
  assigneeId: taskFields.assigneeId.optional(),
  contactId: taskFields.contactId.optional(),
  companyId: taskFields.companyId.optional(),
  note: taskFields.note.optional(),
  dueAt: taskFields.dueAt.optional(),
});

export const taskBulkCreateSchema = taskCreateSchema
  .omit({ contactId: true, companyId: true })
  .extend({ contactIds: z.array(refId).min(1).max(500) });

export const taskUpdateSchema = z
  .object({
    title: taskFields.title.optional(),
    type: taskFields.type.optional(),
    priority: taskFields.priority.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    assigneeId: taskFields.assigneeId.optional(),
    contactId: taskFields.contactId.optional(),
    companyId: taskFields.companyId.optional(),
    note: taskFields.note.optional(),
    dueAt: taskFields.dueAt.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });

export const taskResolveSchema = z.object({ note: z.string().trim().max(5000).optional() });

const assignee = alias(schema.user, "assignee");

const taskColumns = {
  id: schema.task.id,
  title: schema.task.title,
  type: schema.task.type,
  priority: schema.task.priority,
  status: schema.task.status,
  note: schema.task.note,
  dueAt: schema.task.dueAt,
  completedAt: schema.task.completedAt,
  createdAt: schema.task.createdAt,
  updatedAt: schema.task.updatedAt,
  createdById: schema.task.createdById,
  assigneeId: schema.task.assigneeId,
  assigneeName: assignee.name,
  assigneeEmail: assignee.email,
  contactId: schema.task.contactId,
  contactFirstName: schema.contact.firstName,
  contactLastName: schema.contact.lastName,
  contactEmail: schema.contact.email,
  companyId: schema.task.companyId,
  companyName: schema.company.name,
};

type TaskJoinedRow = Awaited<ReturnType<typeof baseQuery>>[number];

export interface TaskDto {
  id: string;
  title: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  note: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  assignee: { id: string; name: string; email: string } | null;
  contact: { id: string; name: string; email: string | null } | null;
  company: { id: string; name: string } | null;
}

function toDto(row: TaskJoinedRow): TaskDto {
  const contactName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ");
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    priority: row.priority,
    status: row.status,
    note: row.note,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
    assignee:
      row.assigneeId && row.assigneeName && row.assigneeEmail
        ? { id: row.assigneeId, name: row.assigneeName, email: row.assigneeEmail }
        : null,
    contact: row.contactId
      ? { id: row.contactId, name: contactName || row.contactEmail || "Unnamed contact", email: row.contactEmail }
      : null,
    company: row.companyId && row.companyName ? { id: row.companyId, name: row.companyName } : null,
  };
}

function baseQuery() {
  return db
    .select(taskColumns)
    .from(schema.task)
    .leftJoin(assignee, eq(assignee.id, schema.task.assigneeId))
    .leftJoin(schema.contact, eq(schema.contact.id, schema.task.contactId))
    .leftJoin(schema.company, eq(schema.company.id, schema.task.companyId));
}

const PRIORITY_ORDER = sql`case ${schema.task.priority} when 'high' then 0 when 'medium' then 1 else 2 end`;

export type TaskSearch = z.infer<typeof taskSearchSchema>;

export async function searchTasks(actor: Actor, input: TaskSearch, page: Page) {
  const where: SQL[] = [eq(schema.task.organizationId, actor.organizationId)];
  if (input.mine) {
    if (!actor.userId) return { tasks: [] as TaskDto[], total: 0 };
    where.push(eq(schema.task.assigneeId, actor.userId));
  }
  if (input.assigneeId) where.push(eq(schema.task.assigneeId, input.assigneeId));
  if (input.status) where.push(inArray(schema.task.status, input.status));
  if (input.type) where.push(inArray(schema.task.type, input.type));
  if (input.priority) where.push(inArray(schema.task.priority, input.priority));
  if (input.contactId) where.push(eq(schema.task.contactId, input.contactId));
  if (input.companyId) where.push(eq(schema.task.companyId, input.companyId));
  if (input.dueAfter) where.push(gte(schema.task.dueAt, input.dueAfter));
  if (input.dueBefore) where.push(lte(schema.task.dueAt, input.dueBefore));
  if (input.q) {
    const term = `%${input.q.replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(ilike(schema.task.title, term), ilike(schema.task.note, term));
    if (match) where.push(match);
  }
  const condition = and(...where);

  const orders: Record<string, SQL[]> = {
    priority: [asc(PRIORITY_ORDER), asc(schema.task.dueAt)],
    created_at: [desc(schema.task.createdAt)],
  };
  const order = orders[input.sort ?? ""] ?? [sql`${schema.task.dueAt} asc nulls last`, desc(schema.task.createdAt)];

  const [rows, [{ count }]] = await Promise.all([
    baseQuery()
      .where(condition)
      .orderBy(...order)
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.task).where(condition),
  ]);
  return { tasks: rows.map(toDto), total: count };
}

export async function getTask(actor: Actor, id: string): Promise<TaskDto> {
  const [row] = await baseQuery()
    .where(and(eq(schema.task.organizationId, actor.organizationId), eq(schema.task.id, id)))
    .limit(1);
  if (!row) throw notFound("Task not found.");
  return toDto(row);
}

async function rawTask(actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(schema.task)
    .where(and(eq(schema.task.organizationId, actor.organizationId), eq(schema.task.id, id)))
    .limit(1);
  if (!row) throw notFound("Task not found.");
  return row;
}

const TYPE_TITLES: Record<TaskType, string> = {
  call: "Call",
  email: "Email",
  linkedin: "LinkedIn touch",
  action_item: "Follow up",
  linkedin_connect: "Send LinkedIn connection request",
  linkedin_message: "Send LinkedIn message",
  linkedin_view: "View LinkedIn profile",
  linkedin_interact: "Interact with LinkedIn post",
};

async function defaultTitle(actor: Actor, type: TaskType, contactId: string | null | undefined) {
  if (!contactId) return TYPE_TITLES[type];
  const [c] = await db
    .select({ firstName: schema.contact.firstName, lastName: schema.contact.lastName, email: schema.contact.email })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, actor.organizationId), eq(schema.contact.id, contactId)))
    .limit(1);
  const name = [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.email;
  return name ? `${TYPE_TITLES[type]} ${name}` : TYPE_TITLES[type];
}

function resolveAssignee(actor: Actor, assigneeId: string | undefined): string {
  const id = assigneeId ?? actor.userId;
  if (!id) throw invalidReference("assigneeId", "Choose who the task is for.");
  return id;
}

export async function createTask(actor: Actor, input: z.infer<typeof taskCreateSchema>): Promise<TaskDto> {
  const assigneeId = resolveAssignee(actor, input.assigneeId);
  await assertWorkspaceMember(actor, assigneeId, "assigneeId");
  let companyId = input.companyId ?? null;
  if (input.contactId) {
    const contact = await contactInScope(actor, input.contactId, "contactId");
    companyId ??= contact.companyId;
  }
  if (input.companyId) await assertCompanyInScope(actor, input.companyId, "companyId");

  const [created] = await db
    .insert(schema.task)
    .values({
      organizationId: actor.organizationId,
      assigneeId,
      contactId: input.contactId ?? null,
      companyId,
      type: input.type,
      priority: input.priority,
      title: input.title ?? (await defaultTitle(actor, input.type, input.contactId)),
      note: input.note ?? null,
      dueAt: input.dueAt ?? null,
      createdById: actor.userId,
    })
    .returning({ id: schema.task.id });
  await audit(actor, "task.create", "task", created.id, { type: input.type, assigneeId });
  return getTask(actor, created.id);
}

export async function bulkCreateTasks(actor: Actor, input: z.infer<typeof taskBulkCreateSchema>): Promise<TaskDto[]> {
  const assigneeId = resolveAssignee(actor, input.assigneeId);
  await assertWorkspaceMember(actor, assigneeId, "assigneeId");
  const contactIds = [...new Set(input.contactIds)];
  const contacts = await contactsInScope(actor, contactIds, "contactIds");
  const companyOf = new Map(contacts.map((c) => [c.id, c.companyId]));

  const values = await Promise.all(
    contactIds.map(async (contactId) => ({
      organizationId: actor.organizationId,
      assigneeId,
      contactId,
      companyId: companyOf.get(contactId) ?? null,
      type: input.type,
      priority: input.priority,
      title: input.title ?? (await defaultTitle(actor, input.type, contactId)),
      note: input.note ?? null,
      dueAt: input.dueAt ?? null,
      createdById: actor.userId,
    })),
  );
  const created = await db.insert(schema.task).values(values).returning({ id: schema.task.id });
  const ids = created.map((c) => c.id);
  await audit(actor, "task.bulk_create", "task", null, { count: ids.length, type: input.type, assigneeId });
  const rows = await baseQuery()
    .where(and(eq(schema.task.organizationId, actor.organizationId), inArray(schema.task.id, ids)))
    .orderBy(asc(schema.task.createdAt));
  return rows.map(toDto);
}

/** Fields that stay editable once a task is completed or skipped. */
const CLOSED_EDITABLE = new Set(["note", "priority", "contactId", "status"]);

export async function updateTask(actor: Actor, id: string, input: z.infer<typeof taskUpdateSchema>): Promise<TaskDto> {
  const current = await rawTask(actor, id);
  const changed = Object.entries(input).filter(([, v]) => v !== undefined);
  if (current.status !== "open") {
    const blocked = changed.filter(([k]) => !CLOSED_EDITABLE.has(k));
    if (blocked.length) {
      throw new HttpError(
        422,
        "Reopen the task before changing that.",
        blocked.map(([path]) => ({ path, message: "Only the note, priority, contact and status can change." })),
      );
    }
  }
  if (input.assigneeId) await assertWorkspaceMember(actor, input.assigneeId, "assigneeId");
  if (input.contactId) await contactInScope(actor, input.contactId, "contactId");
  if (input.companyId) await assertCompanyInScope(actor, input.companyId, "companyId");

  const statusChange =
    input.status && input.status !== current.status
      ? { status: input.status, completedAt: input.status === "open" ? null : new Date() }
      : {};
  await db
    .update(schema.task)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(input.contactId !== undefined && { contactId: input.contactId }),
      ...(input.companyId !== undefined && { companyId: input.companyId }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.dueAt !== undefined && { dueAt: input.dueAt }),
      ...statusChange,
    })
    .where(and(eq(schema.task.organizationId, actor.organizationId), eq(schema.task.id, id)));
  await audit(actor, "task.update", "task", id, { fields: changed.map(([k]) => k) });
  return getTask(actor, id);
}

export async function resolveTask(
  actor: Actor,
  id: string,
  outcome: "completed" | "skipped",
  note: string | undefined,
): Promise<TaskDto> {
  const current = await rawTask(actor, id);
  if (current.status !== "open") {
    throw new HttpError(422, `This task is already ${current.status}.`);
  }
  const nextNote = note && current.note ? `${current.note}\n\n${note}` : (note ?? current.note);
  const [updated] = await db
    .update(schema.task)
    .set({ status: outcome, completedAt: new Date(), note: nextNote })
    .where(
      and(eq(schema.task.organizationId, actor.organizationId), eq(schema.task.id, id), eq(schema.task.status, "open")),
    )
    .returning({ id: schema.task.id });
  if (!updated) throw new HttpError(422, "This task was already closed.");
  await audit(actor, outcome === "completed" ? "task.complete" : "task.skip", "task", id);
  return getTask(actor, id);
}

export async function deleteTask(actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(schema.task)
    .where(and(eq(schema.task.organizationId, actor.organizationId), eq(schema.task.id, id)))
    .returning({ id: schema.task.id });
  if (!deleted.length) throw notFound("Task not found.");
  await audit(actor, "task.delete", "task", id);
}

/** Open tasks for one assignee due before `before` (overdue included). Used by the overview. */
export async function openTasksDueFor(actor: Actor, userId: string, before: Date, limit = 6) {
  const rows = await baseQuery()
    .where(
      and(
        eq(schema.task.organizationId, actor.organizationId),
        eq(schema.task.assigneeId, userId),
        eq(schema.task.status, "open"),
        or(lte(schema.task.dueAt, before), isNull(schema.task.dueAt)),
      ),
    )
    .orderBy(sql`${schema.task.dueAt} asc nulls last`)
    .limit(limit);
  return rows.map(toDto);
}
