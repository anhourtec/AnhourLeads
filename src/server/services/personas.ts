import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";

import { audit } from "./audit";

/**
 * Personas: named sets of job titles, management levels and departments used as a people search
 * filter ("persona" in the filter rail) and when creating a persona from the job titles filter.
 */

export interface PersonaDto {
  id: string;
  name: string;
  titles: string[];
  seniorities: string[];
  departments: string[];
  createdAt: string;
}

type Row = typeof schema.persona.$inferSelect;

export function personaDto(r: Row): PersonaDto {
  return {
    id: r.id,
    name: r.name,
    titles: r.titles,
    seniorities: r.seniorities,
    departments: r.departments,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listPersonas(actor: Actor): Promise<PersonaDto[]> {
  const rows = await db
    .select()
    .from(schema.persona)
    .where(eq(schema.persona.organizationId, actor.organizationId))
    .orderBy(asc(schema.persona.name));
  return rows.map(personaDto);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

const SENIORITY_VALUES = schema.contact.seniority.enumValues;

const uniqueStrings = (max: number, itemMax: number, what: string) =>
  z
    .array(z.string().trim().min(1).max(itemMax, `Keep each ${what} under ${itemMax} characters.`))
    .max(max, `Use at most ${max} ${what}s.`)
    .transform((v) => v.filter((x, i) => v.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i));

const personaShape = {
  name: z.string().trim().min(1, "Name the persona.").max(120, "Keep the name under 120 characters."),
  titles: uniqueStrings(50, 200, "title"),
  seniorities: z
    .array(z.enum(SENIORITY_VALUES, { message: "Pick management levels from the list." }))
    .max(SENIORITY_VALUES.length)
    .transform((v) => [...new Set(v)]),
  departments: uniqueStrings(30, 100, "department"),
};

const hasCriteria = (v: { titles?: string[]; seniorities?: string[]; departments?: string[] }) =>
  [v.titles, v.seniorities, v.departments].some((list) => (list?.length ?? 0) > 0);

export const personaCreateSchema = z
  .object({
    name: personaShape.name,
    titles: personaShape.titles.default([]),
    seniorities: personaShape.seniorities.default([]),
    departments: personaShape.departments.default([]),
  })
  .strict()
  .refine(hasCriteria, {
    message: "Add at least one job title, management level or department.",
    path: ["titles"],
  });
export type PersonaCreateInput = z.infer<typeof personaCreateSchema>;

export const personaUpdateSchema = z
  .object({
    name: personaShape.name.optional(),
    titles: personaShape.titles.optional(),
    seniorities: personaShape.seniorities.optional(),
    departments: personaShape.departments.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type PersonaUpdateInput = z.infer<typeof personaUpdateSchema>;

const invalid = (path: string, message: string) => new HttpError(422, "Some fields are invalid.", [{ path, message }]);

async function findPersona(actor: Actor, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(schema.persona)
    .where(and(eq(schema.persona.organizationId, actor.organizationId), eq(schema.persona.id, id)))
    .limit(1);
  if (!row) throw notFound("Persona not found.");
  return row;
}

async function assertUniqueName(actor: Actor, name: string, exceptId?: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.persona.id })
    .from(schema.persona)
    .where(
      and(
        eq(schema.persona.organizationId, actor.organizationId),
        sql`lower(${schema.persona.name}) = lower(${name})`,
        exceptId ? ne(schema.persona.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (row) throw invalid("name", "A persona with this name already exists.");
}

export async function getPersona(actor: Actor, id: string): Promise<PersonaDto> {
  return personaDto(await findPersona(actor, id));
}

export async function createPersona(actor: Actor, input: PersonaCreateInput): Promise<PersonaDto> {
  await assertUniqueName(actor, input.name);
  const [row] = await db
    .insert(schema.persona)
    .values({ organizationId: actor.organizationId, ...input })
    .returning();
  await audit(actor, "persona.create", "persona", row.id, { name: row.name });
  return personaDto(row);
}

export async function updatePersona(actor: Actor, id: string, input: PersonaUpdateInput): Promise<PersonaDto> {
  const row = await findPersona(actor, id);
  if (input.name !== undefined) await assertUniqueName(actor, input.name, id);
  const next = {
    titles: input.titles ?? row.titles,
    seniorities: input.seniorities ?? row.seniorities,
    departments: input.departments ?? row.departments,
  };
  if (!hasCriteria(next)) throw invalid("titles", "Add at least one job title, management level or department.");
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [updated] = await db
    .update(schema.persona)
    .set(patch)
    .where(and(eq(schema.persona.organizationId, actor.organizationId), eq(schema.persona.id, id)))
    .returning();
  await audit(actor, "persona.update", "persona", id, { fields: Object.keys(patch) });
  return personaDto(updated);
}

export async function deletePersona(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const row = await findPersona(actor, id);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.contact)
      .set({ personaId: null })
      .where(and(eq(schema.contact.organizationId, actor.organizationId), eq(schema.contact.personaId, id)));
    await tx
      .delete(schema.persona)
      .where(and(eq(schema.persona.organizationId, actor.organizationId), eq(schema.persona.id, id)));
  });
  await audit(actor, "persona.delete", "persona", id, { name: row.name });
  return { id, deleted: true };
}
