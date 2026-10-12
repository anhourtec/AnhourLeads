import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";

import { audit } from "./audit";

/**
 * Workspace custom fields for contacts, accounts and deals. Values live in the record's
 * `custom_fields` jsonb column keyed by the field's `key`, and are validated by type here.
 */

export const CUSTOM_FIELD_ENTITIES = schema.customField.entityType.enumValues;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_TYPES = schema.customField.type.enumValues;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomFieldDto {
  id: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  position: number;
  createdAt: string;
}

type Row = typeof schema.customField.$inferSelect;

export function customFieldDto(r: Row): CustomFieldDto {
  return {
    id: r.id,
    entityType: r.entityType,
    key: r.key,
    label: r.label,
    type: r.type,
    options: r.options ?? [],
    position: r.position,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listCustomFields(actor: Actor, entityType?: CustomFieldEntity): Promise<CustomFieldDto[]> {
  const rows = await db
    .select()
    .from(schema.customField)
    .where(
      and(
        eq(schema.customField.organizationId, actor.organizationId),
        entityType ? eq(schema.customField.entityType, entityType) : undefined,
      ),
    )
    .orderBy(asc(schema.customField.position), asc(schema.customField.label));
  return rows.map(customFieldDto);
}

export type CustomFieldValue = string | number | boolean | null;

/**
 * Coerce one raw value (from JSON or a CSV cell) to the field's type. Returns `{ error }` with a
 * plain sentence when the value doesn't fit. Empty strings and null clear the value.
 */
export function coerceCustomFieldValue(
  field: Pick<CustomFieldDto, "type" | "options" | "label">,
  raw: unknown,
): { value: CustomFieldValue } | { error: string } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return { value: null };
  switch (field.type) {
    case "text": {
      const text = String(raw).trim();
      if (text.length > 2000) return { error: `${field.label} is longer than 2,000 characters.` };
      return { value: text };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s_]/g, ""));
      if (!Number.isFinite(n)) return { error: `${field.label} must be a number.` };
      return { value: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      const s = String(raw).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) return { value: true };
      if (["false", "no", "n", "0"].includes(s)) return { value: false };
      return { error: `${field.label} must be yes or no.` };
    }
    case "date": {
      const s = String(raw).trim();
      const t = Date.parse(s);
      if (Number.isNaN(t)) return { error: `${field.label} must be a date like 2026-10-31.` };
      return { value: new Date(t).toISOString().slice(0, 10) };
    }
    case "picklist": {
      const s = String(raw).trim();
      const match = field.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (!match) return { error: `${field.label} must be one of: ${field.options.join(", ")}.` };
      return { value: match };
    }
    case "url": {
      const s = String(raw).trim();
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
      try {
        const url = new URL(withScheme);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) throw new Error("bad");
        return { value: url.toString() };
      } catch {
        return { error: `${field.label} must be a web address.` };
      }
    }
  }
}

/**
 * Validate a `customFields` object from an API body against the workspace's fields for
 * `entityType`. Unknown keys and badly typed values are a 422. Null clears a value.
 */
export async function validateCustomFieldValues(
  actor: Actor,
  entityType: CustomFieldEntity,
  input: unknown,
  path = "customFields",
): Promise<Record<string, CustomFieldValue>> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(422, "Some fields are invalid.", [{ path, message: "Custom fields must be an object." }]);
  }
  const fields = new Map((await listCustomFields(actor, entityType)).map((f) => [f.key, f]));
  const out: Record<string, CustomFieldValue> = {};
  const issues: { path: string; message: string }[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = fields.get(key);
    if (!field) {
      issues.push({ path: `${path}.${key}`, message: `There is no custom field "${key}".` });
      continue;
    }
    const result = coerceCustomFieldValue(field, raw);
    if ("error" in result) issues.push({ path: `${path}.${key}`, message: result.error });
    else out[key] = result.value;
  }
  if (issues.length) throw new HttpError(422, "Some fields are invalid.", issues);
  return out;
}

/** Merge validated values into stored ones (null removes a key). */
export function mergeCustomFieldValues(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, CustomFieldValue>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

const KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;

const optionsSchema = z
  .array(z.string().trim().min(1, "Options can't be empty.").max(100, "Keep each option under 100 characters."))
  .max(100, "Use at most 100 options.")
  .refine((v) => new Set(v.map((o) => o.toLowerCase())).size === v.length, { message: "Options must be unique." });

export const customFieldCreateSchema = z
  .object({
    entityType: z.enum(CUSTOM_FIELD_ENTITIES),
    label: z.string().trim().min(1, "Give the field a label.").max(80, "Keep the label under 80 characters."),
    key: z
      .string()
      .trim()
      .regex(KEY_RE, "Use lowercase letters, digits and underscores, starting with a letter.")
      .optional(),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: optionsSchema.nullable().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "picklist" && !v.options?.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "A picklist needs at least one option." });
    }
    if (v.type !== "picklist" && v.options?.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Only picklists have options." });
    }
  });
export type CustomFieldCreateInput = z.infer<typeof customFieldCreateSchema>;

export const customFieldUpdateSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Give the field a label.")
      .max(80, "Keep the label under 80 characters.")
      .optional(),
    type: z.enum(CUSTOM_FIELD_TYPES).optional(),
    options: optionsSchema.nullable().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type CustomFieldUpdateInput = z.infer<typeof customFieldUpdateSchema>;

const invalid = (path: string, message: string) => new HttpError(422, "Some fields are invalid.", [{ path, message }]);

/** "Annual budget (USD)" → "annual_budget_usd". */
export function keyFromLabel(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const key = /^[a-z]/.test(base) ? base : `field_${base}`.replace(/_+$/, "");
  return key || "field";
}

async function findField(actor: Actor, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(schema.customField)
    .where(and(eq(schema.customField.organizationId, actor.organizationId), eq(schema.customField.id, id)))
    .limit(1);
  if (!row) throw notFound("Custom field not found.");
  return row;
}

async function keyTaken(actor: Actor, entityType: CustomFieldEntity, key: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.customField.id })
    .from(schema.customField)
    .where(
      and(
        eq(schema.customField.organizationId, actor.organizationId),
        eq(schema.customField.entityType, entityType),
        eq(schema.customField.key, key),
        exceptId ? ne(schema.customField.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getCustomField(actor: Actor, id: string): Promise<CustomFieldDto> {
  return customFieldDto(await findField(actor, id));
}

export async function createCustomField(actor: Actor, input: CustomFieldCreateInput): Promise<CustomFieldDto> {
  let key = input.key;
  if (key) {
    if (await keyTaken(actor, input.entityType, key)) throw invalid("key", "Another field already uses this key.");
  } else {
    const base = keyFromLabel(input.label);
    key = base;
    for (let n = 2; await keyTaken(actor, input.entityType, key); n++) key = `${base}_${n}`.slice(0, 50);
  }
  let position = input.position;
  if (position === undefined) {
    const [max] = await db
      .select({ n: sql<number>`coalesce(max(${schema.customField.position}), -1)::int` })
      .from(schema.customField)
      .where(
        and(
          eq(schema.customField.organizationId, actor.organizationId),
          eq(schema.customField.entityType, input.entityType),
        ),
      );
    position = (max?.n ?? -1) + 1;
  }
  const [row] = await db
    .insert(schema.customField)
    .values({
      organizationId: actor.organizationId,
      entityType: input.entityType,
      key,
      label: input.label,
      type: input.type,
      options: input.type === "picklist" ? (input.options ?? []) : null,
      position,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw invalid("key", "Another field already uses this key.");
  await audit(actor, "custom_field.create", "custom_field", row.id, {
    entityType: row.entityType,
    key: row.key,
    type: row.type,
  });
  return customFieldDto(row);
}

export async function updateCustomField(
  actor: Actor,
  id: string,
  input: CustomFieldUpdateInput,
): Promise<CustomFieldDto> {
  const row = await findField(actor, id);
  if (input.type !== undefined && input.type !== row.type) {
    throw invalid("type", "A field's type can't change once it's created. Create a new field instead.");
  }
  const patch: Partial<typeof schema.customField.$inferInsert> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.position !== undefined) patch.position = input.position;
  if (input.options !== undefined) {
    if (row.type !== "picklist") {
      if (input.options?.length) throw invalid("options", "Only picklists have options.");
    } else {
      if (!input.options?.length) throw invalid("options", "A picklist needs at least one option.");
      patch.options = input.options;
    }
  }
  if (!Object.keys(patch).length) return customFieldDto(row);
  const [updated] = await db
    .update(schema.customField)
    .set(patch)
    .where(and(eq(schema.customField.organizationId, actor.organizationId), eq(schema.customField.id, id)))
    .returning();
  await audit(actor, "custom_field.update", "custom_field", id, { fields: Object.keys(patch) });
  return customFieldDto(updated);
}

const VALUE_TABLES = {
  contact: schema.contact,
  company: schema.company,
  deal: schema.deal,
} as const;

/** Delete a field and strip its stored values from every record of that entity in the workspace. */
export async function deleteCustomField(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const row = await findField(actor, id);
  const table = VALUE_TABLES[row.entityType];
  await db.transaction(async (tx) => {
    await tx
      .update(table)
      .set({ customFields: sql`${table.customFields} - ${row.key}` })
      .where(and(eq(table.organizationId, actor.organizationId), sql`${table.customFields} ? ${row.key}`));
    await tx
      .delete(schema.customField)
      .where(and(eq(schema.customField.organizationId, actor.organizationId), eq(schema.customField.id, id)));
  });
  await audit(actor, "custom_field.delete", "custom_field", id, { entityType: row.entityType, key: row.key });
  return { id, deleted: true };
}
