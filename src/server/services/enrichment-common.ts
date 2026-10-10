import "server-only";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { Actor } from "@/server/auth/actor";
import { domainFromInput } from "@/server/crawler/url";
import { db, schema } from "@/server/db";

/**
 * Shared enrichment plumbing: provenance-aware field writes ("never overwrite a field with a
 * lower-confidence value, always write provenance") and do-not-contact checks.
 */

export type EntityType = "company" | "contact";
export type FieldValue = string | number | string[] | null;

export interface FieldProposal {
  field: string;
  value: FieldValue;
  source: string;
  sourceUrl?: string | null;
  confidence: number;
  /** Arrays are merged (union) instead of replaced. */
  merge?: boolean;
}

export interface FieldOutcome {
  field: string;
  value: string | null;
  previous: string | null;
  action: "set" | "refreshed" | "kept_existing";
  confidence: number;
  source: string;
  sourceUrl: string | null;
}

export type ProvenanceRow = typeof schema.fieldProvenance.$inferInsert;

export function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text || null;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Latest provenance confidence per field for one record. */
export async function latestConfidence(
  organizationId: string,
  entityType: EntityType,
  entityId: string,
  fields: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!fields.length) return out;
  const rows = await db
    .select({ field: schema.fieldProvenance.field, confidence: schema.fieldProvenance.confidence })
    .from(schema.fieldProvenance)
    .where(
      and(
        eq(schema.fieldProvenance.organizationId, organizationId),
        eq(schema.fieldProvenance.entityType, entityType),
        eq(schema.fieldProvenance.entityId, entityId),
        inArray(schema.fieldProvenance.field, fields),
      ),
    )
    .orderBy(desc(schema.fieldProvenance.retrievedAt));
  for (const row of rows) if (!out.has(row.field)) out.set(row.field, row.confidence);
  return out;
}

/**
 * Decide which proposed values to write. Empty fields are filled; equal values just refresh
 * provenance; a different existing value is replaced only when the new confidence is at least the
 * existing one (values without provenance were entered by a person and count as 1.0).
 */
export async function planFieldUpdates(
  organizationId: string,
  entityType: EntityType,
  entityId: string,
  current: Record<string, unknown>,
  proposals: FieldProposal[],
): Promise<{ updates: Record<string, unknown>; outcomes: FieldOutcome[]; provenance: ProvenanceRow[] }> {
  const best = new Map<string, FieldProposal>();
  for (const p of proposals) {
    if (isEmpty(p.value)) continue;
    const existing = best.get(p.field);
    if (!existing || p.confidence > existing.confidence) best.set(p.field, p);
  }
  const confidences = await latestConfidence(organizationId, entityType, entityId, [...best.keys()]);
  const updates: Record<string, unknown> = {};
  const outcomes: FieldOutcome[] = [];
  const provenance: ProvenanceRow[] = [];
  const now = new Date();

  for (const p of best.values()) {
    const currentValue = current[p.field];
    let next: FieldValue = p.value;
    if (p.merge && Array.isArray(p.value)) {
      const before = Array.isArray(currentValue) ? currentValue.map(String) : [];
      const merged = [...before];
      for (const v of p.value) if (!merged.some((m) => m.toLowerCase() === v.toLowerCase())) merged.push(v);
      next = merged;
    }
    const nextText = asText(next);
    const previousText = asText(currentValue);
    const outcome = (action: FieldOutcome["action"]): FieldOutcome => ({
      field: p.field,
      value: action === "kept_existing" ? asText(p.value) : nextText,
      previous: previousText,
      action,
      confidence: p.confidence,
      source: p.source,
      sourceUrl: p.sourceUrl ?? null,
    });
    const prov = (): ProvenanceRow => ({
      organizationId,
      entityType,
      entityId,
      field: p.field,
      value: p.merge ? asText(p.value) : nextText,
      source: p.source,
      sourceUrl: p.sourceUrl ?? null,
      confidence: p.confidence,
      retrievedAt: now,
    });

    if (previousText !== null && previousText.toLowerCase() === nextText?.toLowerCase()) {
      outcomes.push(outcome("refreshed"));
      provenance.push(prov());
      continue;
    }
    if (!isEmpty(currentValue) && !p.merge) {
      const existingConfidence = confidences.get(p.field) ?? 1;
      if (p.confidence < existingConfidence) {
        outcomes.push(outcome("kept_existing"));
        continue;
      }
    }
    updates[p.field] = next;
    outcomes.push(outcome("set"));
    provenance.push(prov());
  }
  return { updates, outcomes, provenance };
}

/** Provenance rows for a record, newest first (one per field). */
export async function provenanceFor(organizationId: string, entityType: EntityType, entityId: string) {
  const rows = await db
    .select()
    .from(schema.fieldProvenance)
    .where(
      and(
        eq(schema.fieldProvenance.organizationId, organizationId),
        eq(schema.fieldProvenance.entityType, entityType),
        eq(schema.fieldProvenance.entityId, entityId),
      ),
    )
    .orderBy(desc(schema.fieldProvenance.retrievedAt))
    .limit(200);
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (seen.has(r.field)) return false;
      seen.add(r.field);
      return true;
    })
    .map((r) => ({
      field: r.field,
      value: r.value,
      source: r.source,
      sourceUrl: r.sourceUrl,
      confidence: r.confidence,
      retrievedAt: r.retrievedAt.toISOString(),
    }));
}

/* -------------------------------------------------------------------------- */
/* Do-not-contact                                                             */
/* -------------------------------------------------------------------------- */

/** The domain and every parent domain: mail.acme.co → [mail.acme.co, acme.co]. */
function domainChain(domain: string): string[] {
  const labels = domain.toLowerCase().split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out;
}

/**
 * A predicate telling whether an address (or a bare domain) is on the workspace's do-not-contact
 * list, by exact email or by domain (including parent domains). One query for the whole batch.
 */
export async function suppressionChecker(
  organizationId: string,
  values: string[],
): Promise<(value: string) => boolean> {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const raw of values) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (v.includes("@")) {
      emails.add(v);
      for (const d of domainChain(v.split("@")[1] ?? "")) domains.add(d);
    } else {
      for (const d of domainChain(domainFromInput(v)?.split(":")[0] ?? v)) domains.add(d);
    }
  }
  if (!emails.size && !domains.size) return () => false;
  const conditions = [];
  if (emails.size) {
    conditions.push(
      and(eq(schema.suppression.kind, "email"), inArray(sql`lower(${schema.suppression.value})`, [...emails])),
    );
  }
  if (domains.size) {
    conditions.push(
      and(eq(schema.suppression.kind, "domain"), inArray(sql`lower(${schema.suppression.value})`, [...domains])),
    );
  }
  const rows = await db
    .select({ kind: schema.suppression.kind, value: schema.suppression.value })
    .from(schema.suppression)
    .where(and(eq(schema.suppression.organizationId, organizationId), or(...conditions)));
  const blockedEmails = new Set(rows.filter((r) => r.kind === "email").map((r) => r.value.toLowerCase()));
  const blockedDomains = new Set(rows.filter((r) => r.kind === "domain").map((r) => r.value.toLowerCase()));
  return (value: string) => {
    const v = value.trim().toLowerCase();
    if (v.includes("@")) {
      if (blockedEmails.has(v)) return true;
      return domainChain(v.split("@")[1] ?? "").some((d) => blockedDomains.has(d));
    }
    return domainChain(domainFromInput(v)?.split(":")[0] ?? v).some((d) => blockedDomains.has(d));
  };
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

export async function companyById(actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(schema.company)
    .where(and(eq(schema.company.id, id), eq(schema.company.organizationId, actor.organizationId)))
    .limit(1);
  return row ?? null;
}

export async function companyByDomain(actor: Actor, domain: string) {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const [row] = await db
    .select()
    .from(schema.company)
    .where(
      and(
        eq(schema.company.organizationId, actor.organizationId),
        or(sql`lower(${schema.company.domain}) = ${d}`, sql`lower(${schema.company.domain}) = ${`www.${d}`}`),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function companyByName(actor: Actor, name: string) {
  const [row] = await db
    .select()
    .from(schema.company)
    .where(
      and(
        eq(schema.company.organizationId, actor.organizationId),
        sql`lower(${schema.company.name}) = ${name.trim().toLowerCase()}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function contactById(actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(schema.contact)
    .where(and(eq(schema.contact.id, id), eq(schema.contact.organizationId, actor.organizationId)))
    .limit(1);
  return row ?? null;
}

/** A free lookup recorded in the cost summary. Everything here is free; cached lookups are marked. */
export interface Lookup {
  type: "contact_match" | "company_match" | "pattern_detection" | "email_verification" | "website_crawl";
  target: string;
  cached: boolean;
  cost: number;
}

export function costSummary(lookups: Lookup[]) {
  return {
    consumed: lookups.reduce((sum, l) => sum + l.cost, 0),
    lookups,
    cachedLookups: lookups.filter((l) => l.cached).length,
  };
}
