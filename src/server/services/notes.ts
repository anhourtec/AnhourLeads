import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";

import { audit } from "./audit";
import { recordEvent } from "./events";

/** Notes on contacts, companies and deals. Authors delete their own; note:delete deletes anyone's. */

export const NOTE_ENTITIES = ["contact", "company", "deal"] as const;
export type NoteEntity = (typeof NOTE_ENTITIES)[number];

const entityRef = {
  entityType: z.enum(NOTE_ENTITIES, { message: "Pick contact, company or deal." }),
  entityId: z.string().trim().min(1, "Pick the record the note belongs to.").max(128),
};

export const noteListSchema = z.object(entityRef);
export const noteCreateSchema = z.object({
  ...entityRef,
  body: z.string().trim().min(1, "Write something first.").max(10_000, "Keep notes under 10,000 characters."),
});

export interface NoteDto {
  id: string;
  entityType: NoteEntity;
  entityId: string;
  body: string;
  author: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface EntityLinks {
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  label: string;
}

/** The record the note belongs to, in the actor's workspace (404 otherwise), and its timeline links. */
async function resolveEntity(actor: Actor, entityType: NoteEntity, entityId: string): Promise<EntityLinks> {
  const org = actor.organizationId;
  if (entityType === "contact") {
    const [row] = await db
      .select({ id: schema.contact.id, companyId: schema.contact.companyId })
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.id, entityId)))
      .limit(1);
    if (!row) throw notFound("Contact not found.");
    return { contactId: row.id, companyId: row.companyId, dealId: null, label: "contact" };
  }
  if (entityType === "company") {
    const [row] = await db
      .select({ id: schema.company.id })
      .from(schema.company)
      .where(and(eq(schema.company.organizationId, org), eq(schema.company.id, entityId)))
      .limit(1);
    if (!row) throw notFound("Company not found.");
    return { contactId: null, companyId: row.id, dealId: null, label: "company" };
  }
  const [row] = await db
    .select({ id: schema.deal.id, contactId: schema.deal.contactId, companyId: schema.deal.companyId })
    .from(schema.deal)
    .where(and(eq(schema.deal.organizationId, org), eq(schema.deal.id, entityId)))
    .limit(1);
  if (!row) throw notFound("Deal not found.");
  return { contactId: row.contactId, companyId: row.companyId, dealId: row.id, label: "deal" };
}

const columns = {
  id: schema.note.id,
  entityType: schema.note.entityType,
  entityId: schema.note.entityId,
  body: schema.note.body,
  authorId: schema.note.authorId,
  authorName: schema.user.name,
  createdAt: schema.note.createdAt,
  updatedAt: schema.note.updatedAt,
};

type NoteRow = {
  id: string;
  entityType: NoteEntity;
  entityId: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(r: NoteRow): NoteDto {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    body: r.body,
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? "Former member" } : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listNotes(actor: Actor, input: z.infer<typeof noteListSchema>): Promise<NoteDto[]> {
  await resolveEntity(actor, input.entityType, input.entityId);
  const rows = await db
    .select(columns)
    .from(schema.note)
    .leftJoin(schema.user, eq(schema.user.id, schema.note.authorId))
    .where(
      and(
        eq(schema.note.organizationId, actor.organizationId),
        eq(schema.note.entityType, input.entityType),
        eq(schema.note.entityId, input.entityId),
      ),
    )
    .orderBy(desc(schema.note.createdAt), desc(schema.note.id))
    .limit(500);
  return rows.map(toDto);
}

export async function createNote(actor: Actor, input: z.infer<typeof noteCreateSchema>): Promise<NoteDto> {
  const links = await resolveEntity(actor, input.entityType, input.entityId);
  const [row] = await db
    .insert(schema.note)
    .values({
      organizationId: actor.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      body: input.body,
      authorId: actor.userId,
    })
    .returning({ id: schema.note.id });
  await audit(actor, "note.create", "note", row.id, { entityType: input.entityType, entityId: input.entityId });
  await recordEvent({
    organizationId: actor.organizationId,
    type: "note_added",
    summary: `Note added: ${input.body.length > 120 ? `${input.body.slice(0, 117)}…` : input.body}`,
    contactId: links.contactId,
    companyId: links.companyId,
    dealId: links.dealId,
    actorUserId: actor.userId,
    metadata: { noteId: row.id, entityType: input.entityType },
  });
  const [created] = await db
    .select(columns)
    .from(schema.note)
    .leftJoin(schema.user, eq(schema.user.id, schema.note.authorId))
    .where(eq(schema.note.id, row.id))
    .limit(1);
  return toDto(created);
}

/** Who may delete a note: its author (with note:create) or anyone with note:delete. */
export function canDeleteNote(actor: Pick<Actor, "role" | "userId">, authorId: string | null): boolean {
  if (can(actor.role, "note:delete")) return true;
  return Boolean(actor.userId && authorId === actor.userId && can(actor.role, "note:create"));
}

export async function deleteNote(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const [row] = await db
    .select({ id: schema.note.id, authorId: schema.note.authorId })
    .from(schema.note)
    .where(and(eq(schema.note.organizationId, actor.organizationId), eq(schema.note.id, id)))
    .limit(1);
  if (!row) throw notFound("Note not found.");
  if (!canDeleteNote(actor, row.authorId)) throw forbidden("You can only delete your own notes.");
  await db.delete(schema.note).where(and(eq(schema.note.organizationId, actor.organizationId), eq(schema.note.id, id)));
  await audit(actor, "note.delete", "note", id);
  return { id, deleted: true };
}
