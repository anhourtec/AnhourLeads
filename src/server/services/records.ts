import "server-only";

import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { can, type Permission } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { type AppContext, getAppContext, navigation } from "@/server/auth/context";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";

/**
 * Shared building blocks for the people (contacts) and companies (accounts) services: scope checks
 * for foreign ids, provenance writes, CSV parsing and writing, and common input schemas.
 */

export type EntityType = "contact" | "company";

/* -------------------------------------------------------------------------- */
/* Page actor                                                                 */
/* -------------------------------------------------------------------------- */

/** Actor for a dashboard Server Component; redirects when the role lacks `permission`. */
export async function recordsPageActor(permission: Permission): Promise<{ actor: Actor; context: AppContext }> {
  const context = await getAppContext();
  const workspace = context.workspace;
  if (!workspace || !can(workspace.role, permission)) return (await navigation()).redirect("/unauthorized");
  return {
    context,
    actor: {
      kind: "user",
      userId: context.user.id,
      apiKeyId: null,
      organizationId: workspace.organizationId,
      role: workspace.role,
      isPlatformAdmin: context.user.isPlatformAdmin,
      tenant: context.tenant,
    },
  };
}

/** Where a manual write came from, for provenance. */
export function writeSource(actor: Actor): string {
  return actor.kind === "apiKey" ? "api" : "manual";
}

/* -------------------------------------------------------------------------- */
/* Input helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Optional text: trimmed, empty string becomes null, null clears the field. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const idSchema = z.string().trim().min(1).max(128);

/** String or string[] (query strings and JSON bodies both work), deduplicated, empty values dropped. */
export const stringList = (max = 50, itemMax = 200) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .transform((v) => [...new Set(v.map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(itemMax)).max(max))
    .optional();

export const enumList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.array(z.enum(values))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.enum(values)).max(values.length))
    .optional();

export const tagList = z.array(z.string().trim().min(1).max(50)).max(50);

export const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    return typeof v === "string" ? Number(v) : v;
  }, z.number().int().min(min).max(max).optional());

const BOOL_STRINGS: Record<string, boolean> = { true: true, false: false };

/** Boolean from JSON or a query string ("true" / "false"). */
export const optionalBool = z.preprocess(
  (v) => (typeof v === "string" && v in BOOL_STRINGS ? BOOL_STRINGS[v] : v),
  z.boolean().optional(),
);

/** `%` and `_` are literal in user search text. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const DOMAIN_RE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** "https://www.Example.com/about" → "example.com". Returns null when nothing domain-like remains. */
export function normalizeDomain(value: string): string | null {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  return DOMAIN_RE.test(host) ? host : null;
}

export const domainSchema = z
  .string()
  .trim()
  .max(255)
  .transform((v, ctx) => {
    if (v === "") return null;
    const domain = normalizeDomain(v);
    if (!domain) {
      ctx.addIssue({ code: "custom", message: "Enter a domain like example.com." });
      return z.NEVER;
    }
    return domain;
  })
  .nullable()
  .optional();

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!z.email().safeParse(v).success || v.length > 254) {
      ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
      return z.NEVER;
    }
    return v;
  })
  .nullable()
  .optional();

/** Raise a 422 with the same shape route() uses for zod errors. */
export function unprocessable(message: string, path = ""): HttpError {
  return new HttpError(422, "Some fields are invalid.", [{ path, message }]);
}

/* -------------------------------------------------------------------------- */
/* Scope checks: foreign ids must belong to the actor's workspace (else 404)   */
/* -------------------------------------------------------------------------- */

export async function assertMember(actor: Actor, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) throw notFound("That owner isn't a member of this workspace.");
}

/** Default owner for new records: the acting user, when they're still a member. */
export async function defaultOwner(actor: Actor): Promise<string | null> {
  if (!actor.userId) return null;
  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(schema.member.userId, actor.userId)))
    .limit(1);
  return row ? actor.userId : null;
}

export async function assertCompany(actor: Actor, companyId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(and(eq(schema.company.organizationId, actor.organizationId), eq(schema.company.id, companyId)))
    .limit(1);
  if (!row) throw notFound("Company not found.");
}

export async function assertList(actor: Actor, listId: string, entityType: EntityType): Promise<void> {
  const [row] = await db
    .select({ id: schema.list.id })
    .from(schema.list)
    .where(
      and(
        eq(schema.list.organizationId, actor.organizationId),
        eq(schema.list.id, listId),
        eq(schema.list.entityType, entityType),
      ),
    )
    .limit(1);
  if (!row) throw notFound("List not found.");
}

/** Members of the workspace, for owner pickers. */
export async function workspaceMembers(actor: Actor): Promise<{ id: string; name: string; email: string }[]> {
  return db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, actor.organizationId))
    .orderBy(schema.user.name);
}

/** List membership condition for a search (`entity_id` column of the outer table). */
export function inList(listId: string, entityId: SQL | unknown): SQL {
  return sql`exists (select 1 from ${schema.listMember} where ${schema.listMember.listId} = ${listId} and ${schema.listMember.entityId} = ${entityId})`;
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

export interface ProvenanceInput {
  entityId: string;
  field: string;
  value: unknown;
}

function provenanceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(", ");
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, 1000);
}

export async function recordProvenance(
  actor: Actor,
  entityType: EntityType,
  rows: ProvenanceInput[],
  source: string,
  confidence = 1,
): Promise<void> {
  const values = rows.map((r) => ({
    organizationId: actor.organizationId,
    entityType,
    entityId: r.entityId,
    field: r.field,
    value: provenanceValue(r.value),
    source,
    confidence,
  }));
  for (let i = 0; i < values.length; i += 1000) {
    await db.insert(schema.fieldProvenance).values(values.slice(i, i + 1000));
  }
}

/** Provenance rows for each field that was set (undefined skipped). */
export function provenanceFor(entityId: string, fields: Record<string, unknown>, skip: string[] = []) {
  return Object.entries(fields)
    .filter(([field, value]) => value !== undefined && !skip.includes(field))
    .map(([field, value]) => ({ entityId, field, value }));
}

export interface ProvenanceRow {
  id: string;
  field: string;
  value: string | null;
  source: string;
  sourceUrl: string | null;
  confidence: number;
  retrievedAt: string;
}

export async function provenanceRows(actor: Actor, entityType: EntityType, entityId: string): Promise<ProvenanceRow[]> {
  const rows = await db
    .select()
    .from(schema.fieldProvenance)
    .where(
      and(
        eq(schema.fieldProvenance.organizationId, actor.organizationId),
        eq(schema.fieldProvenance.entityType, entityType),
        eq(schema.fieldProvenance.entityId, entityId),
      ),
    )
    .orderBy(sql`${schema.fieldProvenance.retrievedAt} desc`)
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    value: r.value,
    source: r.source,
    sourceUrl: r.sourceUrl,
    confidence: r.confidence,
    retrievedAt: r.retrievedAt.toISOString(),
  }));
}

/** Remove rows that only make sense while the entity exists (no FK on these tables). */
export async function cleanupEntities(actor: Actor, entityType: EntityType, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db
    .delete(schema.fieldProvenance)
    .where(
      and(
        eq(schema.fieldProvenance.organizationId, actor.organizationId),
        eq(schema.fieldProvenance.entityType, entityType),
        inArray(schema.fieldProvenance.entityId, ids),
      ),
    );
  await db.delete(schema.listMember).where(
    and(
      inArray(schema.listMember.entityId, ids),
      inArray(
        schema.listMember.listId,
        db
          .select({ id: schema.list.id })
          .from(schema.list)
          .where(and(eq(schema.list.organizationId, actor.organizationId), eq(schema.list.entityType, entityType))),
      ),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const EXPORT_MAX_ROWS = 10_000;

function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF, comma/semicolon/tab delimiters. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

type CsvCell = string | number | boolean | null | undefined | Date | string[];

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (Array.isArray(value)) text = value.join("; ");
  else if (value instanceof Date) text = value.toISOString();
  else text = String(value);
  // Spreadsheet formula injection: a leading = + - @ (or tab/CR) would be evaluated.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Header → field, lowercased and stripped of everything but letters and digits. */
export function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface ImportPayload {
  csv: string;
  mapping: Record<string, string | null>;
  updateExisting: boolean;
  /** Raw import settings (validated by the import pipeline): stage, duplicates, accounts, list, enrichment. */
  settings: Record<string, unknown>;
  /** Uploaded file name, when known. */
  fileName: string | null;
}

const SETTING_KEYS = [
  "stageMode",
  "stage",
  "ifExists",
  "autoAssignAccounts",
  "listId",
  "newListName",
  "fileName",
  "enrichment",
] as const;

function pickSettings(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  return out;
}

const importOptions = z.object({
  mapping: z.record(z.string().max(200), z.string().max(64).nullable()).optional(),
  updateExisting: optionalBool,
});

/**
 * Read a CSV upload from multipart/form-data (`file`, optional `mapping` JSON and `updateExisting`),
 * a JSON body (`{ csv, mapping?, updateExisting? }`) or a raw text/csv body (options in the query).
 */
export async function readImport(req: Request): Promise<ImportPayload> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > IMPORT_MAX_BYTES + 64 * 1024) throw new HttpError(413, "The file is larger than 5 MB.");
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const query = Object.fromEntries(new URL(req.url).searchParams);
  let csv: string;
  let options: unknown;
  let settings: Record<string, unknown> = pickSettings(query);
  let fileName: string | null = typeof query.fileName === "string" ? query.fileName : null;
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) throw unprocessable("Attach a CSV file in the `file` field.", "file");
    if (file.size > IMPORT_MAX_BYTES) throw new HttpError(413, "The file is larger than 5 MB.");
    csv = await file.text();
    if (file instanceof File && file.name) fileName = file.name;
    const rawSettings = form.get("settings");
    if (typeof rawSettings === "string" && rawSettings) {
      try {
        const parsedSettings: unknown = JSON.parse(rawSettings);
        settings = { ...settings, ...pickSettings(asObject(parsedSettings)) };
      } catch {
        throw unprocessable("Settings must be a JSON object.", "settings");
      }
    }
    const mapping = form.get("mapping");
    let parsedMapping: unknown;
    if (typeof mapping === "string" && mapping) {
      try {
        parsedMapping = JSON.parse(mapping);
      } catch {
        throw unprocessable("Mapping must be a JSON object.", "mapping");
      }
    }
    options = { mapping: parsedMapping, updateExisting: form.get("updateExisting") ?? undefined };
  } else if (type.includes("application/json")) {
    const text = await req.text();
    if (text.length > IMPORT_MAX_BYTES * 1.5) throw new HttpError(413, "The file is larger than 5 MB.");
    const body = z
      .object({ csv: z.string().min(1, "Paste or upload a CSV file.") })
      .passthrough()
      .parse(text ? JSON.parse(text) : {});
    csv = body.csv;
    options = body;
    const nested = body.settings && typeof body.settings === "object" ? asObject(body.settings) : {};
    settings = { ...settings, ...pickSettings(body), ...pickSettings(nested) };
  } else {
    csv = await req.text();
    options = { updateExisting: query.updateExisting };
  }
  if (new TextEncoder().encode(csv).length > IMPORT_MAX_BYTES)
    throw new HttpError(413, "The file is larger than 5 MB.");
  if (!csv.trim()) throw unprocessable("The file is empty.", "file");
  const parsed = importOptions.parse(options);
  if (typeof settings.fileName === "string") fileName = settings.fileName;
  return {
    csv,
    mapping: parsed.mapping ?? {},
    updateExisting: parsed.updateExisting ?? true,
    settings,
    fileName: fileName ? fileName.slice(0, 200) : null,
  };
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  columns: Record<string, string | null>;
}

/**
 * Split a CSV into header + rows and map each header to a field using `aliases`
 * (normalized header key → field) and the caller's explicit `mapping` (header → field or null).
 */
export function mapCsv(
  csv: string,
  aliases: Record<string, string>,
  fields: readonly string[],
  mapping: Record<string, string | null>,
): { columns: Record<string, string | null>; rows: Record<string, string>[] } {
  const table = parseCsv(csv);
  if (table.length < 2) throw unprocessable("The file needs a header row and at least one data row.", "file");
  const [header, ...data] = table;
  if (data.length > IMPORT_MAX_ROWS) {
    throw unprocessable(`Import up to ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows at a time.`, "file");
  }
  const columns: Record<string, string | null> = {};
  const used = new Set<string>();
  header.forEach((raw) => {
    const name = raw.trim();
    const explicit = Object.hasOwn(mapping, name) ? mapping[name] : undefined;
    let field: string | null = explicit === undefined ? (aliases[headerKey(name)] ?? null) : explicit;
    if (field && !fields.includes(field)) {
      throw unprocessable(`"${field}" isn't a field you can import into.`, `mapping.${name}`);
    }
    if (field && used.has(field)) field = null;
    if (field) used.add(field);
    columns[name] = field;
  });
  if (!used.size) throw unprocessable("None of the columns match a field. Check the header row.", "file");
  const rows = data.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((raw, index) => {
      const field = columns[raw.trim()];
      const value = cells[index]?.trim();
      if (field && value) record[field] = value;
    });
    return record;
  });
  return { columns, rows };
}

/** Parse loosely formatted integers from CSV ("1,200", "1.2k" is rejected). */
export function csvInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/[,\s_]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** "Sales; Marketing | Ops" → ["Sales", "Marketing", "Ops"]. */
export function csvList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(/[;|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)].slice(0, 50) : undefined;
}

/** Map a free-text value onto one of `values` ("C-Suite" → "c_suite"). */
export function csvEnum<T extends string>(value: string | undefined, values: readonly T[]): T | undefined {
  if (!value) return undefined;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return values.find((v) => v === key);
}

export function assertBatch(size: number, max: number, what: string): void {
  if (size === 0) throw unprocessable(`Pass at least one ${what}.`);
  if (size > max) throw unprocessable(`Pass up to ${max.toLocaleString("en-US")} ${what}s at a time.`);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Query string → object; repeated keys (and `key[]`) become arrays. */
export function queryObject(url: string | URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [rawKey, value] of new URL(url).searchParams) {
    const key = rawKey.replace(/\[\]$/, "");
    const prev = out[key];
    if (prev === undefined) out[key] = rawKey.endsWith("[]") ? [value] : value;
    else out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/** Read a JSON object body (422 when it isn't an object). */
export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw unprocessable("Send a JSON object.");
}
