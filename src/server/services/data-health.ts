import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { type Actor, requirePermission } from "@/server/auth/actor";
import type { CrawlFindings } from "@/server/crawler/types";
import { db, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http/errors";

import { audit } from "./audit";
import { type Segment, STALE_VERIFICATION_DAYS } from "./enrichment-jobs";
import { USAGE_ACTION } from "./usage-events";

/**
 * Data health center: what can be enriched, duplicates (and merging them), enrichment activity and
 * job-change hints. Everything is computed from the workspace's own data, scoped by the actor.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
type ContactRow = typeof schema.contact.$inferSelect;
type CompanyRow = typeof schema.company.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Health summary                                                             */
/* -------------------------------------------------------------------------- */

export interface HealthCard {
  segment: Segment;
  entityType: "contact" | "company";
  label: string;
  description: string;
  count: number;
  total: number;
}

export interface ActivityDay {
  date: string;
  jobs: number;
}

export interface DataHealth {
  contacts: number;
  companies: number;
  verifiedRate: number | null;
  cards: HealthCard[];
  duplicates: { contacts: number; companies: number };
  activity: {
    days: ActivityDay[];
    jobs: number;
    rowsProcessed: number;
    lookups: number;
    cacheHits: number;
  };
  generatedAt: string;
}

const n = sql<number>`count(*)::int`;

export async function getDataHealth(actor: Actor): Promise<DataHealth> {
  const org = actor.organizationId;
  const c = schema.contact;
  const co = schema.company;
  const staleBefore = new Date(Date.now() - STALE_VERIFICATION_DAYS * DAY_MS);
  const since = new Date(Date.now() - 30 * DAY_MS);

  const [contactStats, companyStats, jobsByDay, usage, dupes] = await Promise.all([
    db
      .select({
        total: n,
        withEmail: sql<number>`count(${c.email})::int`,
        missingEmail: sql<number>`count(*) filter (where ${c.email} is null)::int`,
        unverified: sql<number>`count(*) filter (where ${c.email} is not null and ${c.emailStatus} in ('unverified','unknown'))::int`,
        stale: sql<number>`count(*) filter (where ${c.email} is not null and ${c.emailVerifiedAt} < ${staleBefore})::int`,
        valid: sql<number>`count(*) filter (where ${c.emailStatus} = 'valid')::int`,
        noCompany: sql<number>`count(*) filter (where ${c.companyId} is null)::int`,
      })
      .from(c)
      .where(eq(c.organizationId, org)),
    db
      .select({
        total: n,
        missing: sql<number>`count(*) filter (where ${co.industry} is null or ${co.employeeCount} is null or ${co.description} is null)::int`,
      })
      .from(co)
      .where(eq(co.organizationId, org)),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${schema.enrichmentJob.createdAt}), 'YYYY-MM-DD')`,
        jobs: n,
        rows: sql<number>`coalesce(sum(${schema.enrichmentJob.processed}), 0)::int`,
      })
      .from(schema.enrichmentJob)
      .where(
        and(
          eq(schema.enrichmentJob.organizationId, org),
          gte(schema.enrichmentJob.createdAt, since),
          sql`coalesce(${schema.enrichmentJob.options}->>'automation', 'false') <> 'true'`,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        lookups: sql<number>`coalesce(sum((${schema.auditLog.metadata}->>'total')::int), 0)::int`,
        cached: sql<number>`coalesce(sum((${schema.auditLog.metadata}->>'cached')::int), 0)::int`,
      })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, org),
          eq(schema.auditLog.action, USAGE_ACTION),
          gte(schema.auditLog.createdAt, since),
        ),
      ),
    findDuplicates(actor, 200),
  ]);

  const s = contactStats[0];
  const cs = companyStats[0];
  const contacts = s?.total ?? 0;
  const companies = cs?.total ?? 0;
  const byDay = new Map(jobsByDay.map((d) => [d.day, d]));
  const days: ActivityDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    days.push({ date, jobs: byDay.get(date)?.jobs ?? 0 });
  }

  return {
    contacts,
    companies,
    verifiedRate: s?.withEmail ? s.valid / s.withEmail : null,
    cards: [
      {
        segment: "missing_email",
        entityType: "contact",
        label: "Contacts missing an email",
        description: "Find an address from the company's website or its email format.",
        count: s?.missingEmail ?? 0,
        total: contacts,
      },
      {
        segment: "unverified_email",
        entityType: "contact",
        label: "Unverified or unknown emails",
        description: "Check each address before you send to it.",
        count: s?.unverified ?? 0,
        total: contacts,
      },
      {
        segment: "stale_verification",
        entityType: "contact",
        label: `Verified more than ${STALE_VERIFICATION_DAYS} days ago`,
        description: "People change jobs. Check these addresses again.",
        count: s?.stale ?? 0,
        total: contacts,
      },
      {
        segment: "company_missing_firmographics",
        entityType: "company",
        label: "Companies missing industry, size or description",
        description: "Fill the gaps from each company's public website.",
        count: cs?.missing ?? 0,
        total: companies,
      },
      {
        segment: "contact_without_company",
        entityType: "contact",
        label: "Contacts without a company",
        description: "Link people to a company from their email domain.",
        count: s?.noCompany ?? 0,
        total: contacts,
      },
    ],
    duplicates: {
      contacts: dupes.filter((g) => g.entityType === "contact").length,
      companies: dupes.filter((g) => g.entityType === "company").length,
    },
    activity: {
      days,
      jobs: jobsByDay.reduce((sum, d) => sum + d.jobs, 0),
      rowsProcessed: jobsByDay.reduce((sum, d) => sum + d.rows, 0),
      lookups: usage[0]?.lookups ?? 0,
      cacheHits: usage[0]?.cached ?? 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Duplicates                                                                 */
/* -------------------------------------------------------------------------- */

const CONTACT_FIELDS = [
  "firstName",
  "lastName",
  "title",
  "seniority",
  "department",
  "email",
  "phone",
  "linkedinUrl",
  "city",
  "state",
  "country",
  "timezone",
  "companyId",
  "ownerId",
  "consentBasis",
  "personaId",
] as const satisfies ReadonlyArray<keyof ContactRow>;

const COMPANY_FIELDS = [
  "domain",
  "websiteUrl",
  "linkedinUrl",
  "twitterUrl",
  "phone",
  "industry",
  "employeeCount",
  "annualRevenue",
  "foundedYear",
  "description",
  "city",
  "state",
  "country",
  "emailPattern",
  "ownerId",
] as const satisfies ReadonlyArray<keyof CompanyRow>;

function filled(row: Record<string, unknown>, fields: readonly string[]): number {
  let total = 0;
  for (const f of fields) {
    const v = row[f];
    if (v !== null && v !== undefined && v !== "") total += 1;
  }
  for (const f of ["tags", "keywords", "technologies"]) {
    const v = row[f];
    if (Array.isArray(v) && v.length) total += 1;
  }
  return total;
}

export interface DuplicateRecord {
  id: string;
  name: string;
  detail: string | null;
  filledFields: number;
  createdAt: string;
}

export interface DuplicateGroup {
  key: string;
  entityType: "contact" | "company";
  reason: "same_email" | "same_name_and_company" | "same_domain" | "same_name";
  records: DuplicateRecord[];
  /** The record a merge keeps: the one with more filled fields, then the oldest. */
  keepId: string;
}

function contactName(r: Pick<ContactRow, "firstName" | "lastName" | "email">): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Unnamed contact";
}

function pickKeep<T extends { id: string; createdAt: Date }>(rows: T[], score: (r: T) => number): T {
  return [...rows].sort((a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime())[0] as T;
}

function contactGroup(key: string, reason: DuplicateGroup["reason"], rows: ContactRow[]): DuplicateGroup {
  const score = (r: ContactRow) => filled(r as unknown as Record<string, unknown>, CONTACT_FIELDS);
  return {
    key,
    entityType: "contact",
    reason,
    keepId: pickKeep(rows, score).id,
    records: rows.map((r) => ({
      id: r.id,
      name: contactName(r),
      detail: r.email ?? r.title,
      filledFields: score(r),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

function companyGroup(key: string, reason: DuplicateGroup["reason"], rows: CompanyRow[]): DuplicateGroup {
  const score = (r: CompanyRow) => filled(r as unknown as Record<string, unknown>, COMPANY_FIELDS);
  return {
    key,
    entityType: "company",
    reason,
    keepId: pickKeep(rows, score).id,
    records: rows.map((r) => ({
      id: r.id,
      name: r.name,
      detail: r.domain,
      filledFields: score(r),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Duplicate groups: same email, same name at the same company, companies with the same domain or name. */
export async function findDuplicates(actor: Actor, limit = 50): Promise<DuplicateGroup[]> {
  const org = actor.organizationId;
  const c = schema.contact;
  const co = schema.company;
  const emailKey = sql<string>`lower(${c.email})`;
  const nameKey = sql<string>`lower(coalesce(${c.firstName}, '')) || '|' || lower(coalesce(${c.lastName}, '')) || '|' || ${c.companyId}`;
  const domainKey = sql<string>`regexp_replace(lower(${co.domain}), '^www\\.', '')`;
  const companyNameKey = sql<string>`lower(trim(${co.name}))`;

  const [emailKeys, nameKeys, domainKeys, companyNameKeys] = await Promise.all([
    db
      .select({ key: emailKey })
      .from(c)
      .where(and(eq(c.organizationId, org), isNotNull(c.email)))
      .groupBy(emailKey)
      .having(sql`count(*) > 1`)
      .orderBy(sql`max(${c.createdAt}) desc`)
      .limit(limit),
    db
      .select({ key: nameKey })
      .from(c)
      .where(and(eq(c.organizationId, org), isNotNull(c.companyId), isNotNull(c.firstName), isNotNull(c.lastName)))
      .groupBy(nameKey)
      .having(sql`count(*) > 1`)
      .orderBy(sql`max(${c.createdAt}) desc`)
      .limit(limit),
    db
      .select({ key: domainKey })
      .from(co)
      .where(and(eq(co.organizationId, org), isNotNull(co.domain)))
      .groupBy(domainKey)
      .having(sql`count(*) > 1`)
      .orderBy(sql`max(${co.createdAt}) desc`)
      .limit(limit),
    db
      .select({ key: companyNameKey })
      .from(co)
      .where(eq(co.organizationId, org))
      .groupBy(companyNameKey)
      .having(sql`count(*) > 1`)
      .orderBy(sql`max(${co.createdAt}) desc`)
      .limit(limit),
  ]);

  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const add = (g: DuplicateGroup) => {
    const signature = `${g.entityType}:${g.records
      .map((r) => r.id)
      .sort()
      .join(",")}`;
    if (seen.has(signature) || g.records.length < 2) return;
    seen.add(signature);
    groups.push(g);
  };

  if (emailKeys.length) {
    const rows = await db
      .select()
      .from(c)
      .where(
        and(
          eq(c.organizationId, org),
          inArray(
            emailKey,
            emailKeys.map((k) => k.key),
          ),
        ),
      );
    for (const k of emailKeys) {
      add(
        contactGroup(
          `email:${k.key}`,
          "same_email",
          rows.filter((r) => r.email?.toLowerCase() === k.key),
        ),
      );
    }
  }
  if (nameKeys.length) {
    const rows = await db
      .select()
      .from(c)
      .where(
        and(
          eq(c.organizationId, org),
          inArray(
            nameKey,
            nameKeys.map((k) => k.key),
          ),
        ),
      );
    for (const k of nameKeys) {
      const key = (r: ContactRow) =>
        `${(r.firstName ?? "").toLowerCase()}|${(r.lastName ?? "").toLowerCase()}|${r.companyId}`;
      add(
        contactGroup(
          `name:${k.key}`,
          "same_name_and_company",
          rows.filter((r) => key(r) === k.key),
        ),
      );
    }
  }
  if (domainKeys.length) {
    const rows = await db
      .select()
      .from(co)
      .where(
        and(
          eq(co.organizationId, org),
          inArray(
            domainKey,
            domainKeys.map((k) => k.key),
          ),
        ),
      );
    for (const k of domainKeys) {
      const key = (r: CompanyRow) => (r.domain ?? "").toLowerCase().replace(/^www\./, "");
      add(
        companyGroup(
          `domain:${k.key}`,
          "same_domain",
          rows.filter((r) => key(r) === k.key),
        ),
      );
    }
  }
  if (companyNameKeys.length) {
    const rows = await db
      .select()
      .from(co)
      .where(
        and(
          eq(co.organizationId, org),
          inArray(
            companyNameKey,
            companyNameKeys.map((k) => k.key),
          ),
        ),
      );
    for (const k of companyNameKeys) {
      add(
        companyGroup(
          `cname:${k.key}`,
          "same_name",
          rows.filter((r) => r.name.trim().toLowerCase() === k.key),
        ),
      );
    }
  }
  const newest = (g: DuplicateGroup) => Math.max(...g.records.map((r) => Date.parse(r.createdAt)));
  return groups.sort((a, b) => newest(b) - newest(a)).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                      */
/* -------------------------------------------------------------------------- */

export const mergeInput = z
  .object({
    entityType: z.enum(["contact", "company"]),
    ids: z.array(z.string().trim().min(1).max(128)).min(2).max(10),
    /** Record to keep. Defaults to the one with more filled fields. */
    keepId: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, { message: "Pick different records.", path: ["ids"] })
  .refine((v) => !v.keepId || v.ids.includes(v.keepId), {
    message: "Keep one of the picked records.",
    path: ["keepId"],
  });
export type MergeInput = z.infer<typeof mergeInput>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Fields of `from` that fill empty fields of `into`. */
function fillFrom<T extends Record<string, unknown>>(into: T, from: T, fields: readonly string[]) {
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    const has = into[f] !== null && into[f] !== undefined && into[f] !== "";
    const other = from[f];
    if (!has && other !== null && other !== undefined && other !== "") patch[f] = other;
  }
  return patch;
}

function union(a: unknown, b: unknown): string[] {
  const out = Array.isArray(a) ? a.map(String) : [];
  for (const v of Array.isArray(b) ? b.map(String) : []) {
    if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/** Move provenance for fields taken from the merged record; drop the rest (they described values that are gone). */
async function moveProvenance(
  tx: Tx,
  org: string,
  entityType: "contact" | "company",
  fromId: string,
  toId: string,
  fields: string[],
) {
  const p = schema.fieldProvenance;
  const scope = and(eq(p.organizationId, org), eq(p.entityType, entityType), eq(p.entityId, fromId));
  if (fields.length) {
    await tx
      .update(p)
      .set({ entityId: toId })
      .where(and(scope, inArray(p.field, fields)));
  }
  await tx.delete(p).where(scope);
}

async function moveListMembers(tx: Tx, org: string, entityType: "contact" | "company", fromId: string, toId: string) {
  const lists = tx
    .select({ id: schema.list.id })
    .from(schema.list)
    .where(and(eq(schema.list.organizationId, org), eq(schema.list.entityType, entityType)));
  const rows = await tx
    .select({ listId: schema.listMember.listId })
    .from(schema.listMember)
    .where(and(eq(schema.listMember.entityId, fromId), inArray(schema.listMember.listId, lists)));
  if (rows.length) {
    await tx
      .insert(schema.listMember)
      .values(rows.map((r) => ({ listId: r.listId, entityId: toId })))
      .onConflictDoNothing();
    await tx.delete(schema.listMember).where(
      and(
        eq(schema.listMember.entityId, fromId),
        inArray(
          schema.listMember.listId,
          rows.map((r) => r.listId),
        ),
      ),
    );
  }
  return rows.length;
}

async function mergeContacts(actor: Actor, keep: ContactRow, other: ContactRow) {
  const org = actor.organizationId;
  return db.transaction(async (tx) => {
    const patch = fillFrom(
      keep as unknown as Record<string, unknown>,
      other as unknown as Record<string, unknown>,
      CONTACT_FIELDS,
    );
    const tags = union(keep.tags, other.tags);
    const customFields = { ...(other.customFields ?? {}), ...(keep.customFields ?? {}) };
    if (patch.email) {
      await tx.update(schema.contact).set({ email: null }).where(eq(schema.contact.id, other.id));
    }
    await tx
      .update(schema.contact)
      .set({ ...(patch as Partial<ContactRow>), tags, customFields })
      .where(and(eq(schema.contact.id, keep.id), eq(schema.contact.organizationId, org)));

    const lists = await moveListMembers(tx, org, "contact", other.id, keep.id);
    const keptSequences = tx
      .select({ id: schema.enrollment.sequenceId })
      .from(schema.enrollment)
      .where(eq(schema.enrollment.contactId, keep.id));
    const enrollments = await tx
      .update(schema.enrollment)
      .set({ contactId: keep.id })
      .where(
        and(
          eq(schema.enrollment.organizationId, org),
          eq(schema.enrollment.contactId, other.id),
          sql`${schema.enrollment.sequenceId} not in (${keptSequences})`,
        ),
      )
      .returning({ id: schema.enrollment.id });
    const tasks = await tx
      .update(schema.task)
      .set({ contactId: keep.id })
      .where(and(eq(schema.task.organizationId, org), eq(schema.task.contactId, other.id)))
      .returning({ id: schema.task.id });
    const deals = await tx
      .update(schema.deal)
      .set({ contactId: keep.id })
      .where(and(eq(schema.deal.organizationId, org), eq(schema.deal.contactId, other.id)))
      .returning({ id: schema.deal.id });
    const notes = await tx
      .update(schema.note)
      .set({ entityId: keep.id })
      .where(
        and(
          eq(schema.note.organizationId, org),
          eq(schema.note.entityType, "contact"),
          eq(schema.note.entityId, other.id),
        ),
      )
      .returning({ id: schema.note.id });
    await tx
      .update(schema.activity)
      .set({ contactId: keep.id })
      .where(and(eq(schema.activity.organizationId, org), eq(schema.activity.contactId, other.id)));
    await tx
      .update(schema.outboundMessage)
      .set({ contactId: keep.id })
      .where(and(eq(schema.outboundMessage.organizationId, org), eq(schema.outboundMessage.contactId, other.id)));
    await moveProvenance(tx, org, "contact", other.id, keep.id, Object.keys(patch));
    await tx.delete(schema.contact).where(and(eq(schema.contact.id, other.id), eq(schema.contact.organizationId, org)));
    return {
      fields: Object.keys(patch),
      lists,
      enrollments: enrollments.length,
      tasks: tasks.length,
      deals: deals.length,
      notes: notes.length,
    };
  });
}

async function mergeCompanies(actor: Actor, keep: CompanyRow, other: CompanyRow) {
  const org = actor.organizationId;
  return db.transaction(async (tx) => {
    const patch = fillFrom(
      keep as unknown as Record<string, unknown>,
      other as unknown as Record<string, unknown>,
      COMPANY_FIELDS,
    );
    const keywords = union(keep.keywords, other.keywords);
    const technologies = union(keep.technologies, other.technologies);
    const customFields = { ...(other.customFields ?? {}), ...(keep.customFields ?? {}) };
    await tx.update(schema.company).set({ domain: null }).where(eq(schema.company.id, other.id));
    await tx
      .update(schema.company)
      .set({ ...(patch as Partial<CompanyRow>), keywords, technologies, customFields })
      .where(and(eq(schema.company.id, keep.id), eq(schema.company.organizationId, org)));

    const lists = await moveListMembers(tx, org, "company", other.id, keep.id);
    const contacts = await tx
      .update(schema.contact)
      .set({ companyId: keep.id })
      .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.companyId, other.id)))
      .returning({ id: schema.contact.id });
    const tasks = await tx
      .update(schema.task)
      .set({ companyId: keep.id })
      .where(and(eq(schema.task.organizationId, org), eq(schema.task.companyId, other.id)))
      .returning({ id: schema.task.id });
    const deals = await tx
      .update(schema.deal)
      .set({ companyId: keep.id })
      .where(and(eq(schema.deal.organizationId, org), eq(schema.deal.companyId, other.id)))
      .returning({ id: schema.deal.id });
    const notes = await tx
      .update(schema.note)
      .set({ entityId: keep.id })
      .where(
        and(
          eq(schema.note.organizationId, org),
          eq(schema.note.entityType, "company"),
          eq(schema.note.entityId, other.id),
        ),
      )
      .returning({ id: schema.note.id });
    await tx
      .update(schema.activity)
      .set({ companyId: keep.id })
      .where(and(eq(schema.activity.organizationId, org), eq(schema.activity.companyId, other.id)));
    await tx
      .update(schema.crawlJob)
      .set({ companyId: keep.id })
      .where(and(eq(schema.crawlJob.organizationId, org), eq(schema.crawlJob.companyId, other.id)));
    await moveProvenance(tx, org, "company", other.id, keep.id, Object.keys(patch));
    await tx.delete(schema.company).where(and(eq(schema.company.id, other.id), eq(schema.company.organizationId, org)));
    return {
      fields: Object.keys(patch),
      lists,
      contacts: contacts.length,
      tasks: tasks.length,
      deals: deals.length,
      notes: notes.length,
    };
  });
}

/** Merge duplicates into one record: the richer record (or `keepId`) survives and gains everything linked to the others. */
export async function mergeDuplicates(actor: Actor, input: MergeInput) {
  requirePermission(actor, input.entityType === "contact" ? "contact:delete" : "company:delete");
  requirePermission(actor, input.entityType === "contact" ? "contact:update" : "company:update");
  const org = actor.organizationId;
  if (input.entityType === "contact") {
    const rows = await db
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, org), inArray(schema.contact.id, input.ids)));
    if (rows.length !== input.ids.length) throw notFound("Contact not found.");
    const keep =
      rows.find((r) => r.id === input.keepId) ??
      pickKeep(rows, (r) => filled(r as unknown as Record<string, unknown>, CONTACT_FIELDS));
    let current = keep;
    const moved = [];
    for (const other of rows.filter((r) => r.id !== keep.id)) {
      moved.push({ id: other.id, ...(await mergeContacts(actor, current, other)) });
      const [fresh] = await db.select().from(schema.contact).where(eq(schema.contact.id, keep.id)).limit(1);
      if (!fresh) throw new HttpError(500, "The kept record disappeared during the merge.");
      current = fresh;
    }
    await audit(actor, "contact.merge", "contact", keep.id, { merged: moved.map((m) => m.id) });
    return { entityType: "contact" as const, keptId: keep.id, mergedIds: moved.map((m) => m.id), moved };
  }
  const rows = await db
    .select()
    .from(schema.company)
    .where(and(eq(schema.company.organizationId, org), inArray(schema.company.id, input.ids)));
  if (rows.length !== input.ids.length) throw notFound("Company not found.");
  const keep =
    rows.find((r) => r.id === input.keepId) ??
    pickKeep(rows, (r) => filled(r as unknown as Record<string, unknown>, COMPANY_FIELDS));
  let current = keep;
  const moved = [];
  for (const other of rows.filter((r) => r.id !== keep.id)) {
    moved.push({ id: other.id, ...(await mergeCompanies(actor, current, other)) });
    const [fresh] = await db.select().from(schema.company).where(eq(schema.company.id, keep.id)).limit(1);
    if (!fresh) throw new HttpError(500, "The kept record disappeared during the merge.");
    current = fresh;
  }
  await audit(actor, "company.merge", "company", keep.id, { merged: moved.map((m) => m.id) });
  return { entityType: "company" as const, keptId: keep.id, mergedIds: moved.map((m) => m.id), moved };
}

/* -------------------------------------------------------------------------- */
/* Job changes                                                                */
/* -------------------------------------------------------------------------- */

export interface JobChange {
  contactId: string;
  name: string;
  email: string | null;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
  stage: string;
  signal: "strong" | "hint";
  reason: string;
  sourceUrl: string | null;
  detectedAt: string;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Contacts who may have changed jobs: their email started bouncing, or the company's crawled team
 * page stopped listing them. A name missing from a team page is only a hint; many sites list only
 * leadership.
 */
export async function findJobChanges(actor: Actor, limit = 200): Promise<JobChange[]> {
  const org = actor.organizationId;
  const c = schema.contact;
  const out = new Map<string, JobChange>();

  // 1) Bouncing addresses: a bounced message, or invalid now after an earlier valid result.
  const bounced = await db
    .select({ contact: c, companyName: schema.company.name, at: sql<Date>`max(${schema.outboundMessage.createdAt})` })
    .from(schema.outboundMessage)
    .innerJoin(c, eq(c.id, schema.outboundMessage.contactId))
    .leftJoin(schema.company, eq(schema.company.id, c.companyId))
    .where(
      and(
        eq(schema.outboundMessage.organizationId, org),
        eq(schema.outboundMessage.status, "bounced"),
        sql`${c.stage} not in ('changed_job','do_not_contact')`,
      ),
    )
    .groupBy(c.id, schema.company.name)
    .limit(limit);
  for (const r of bounced) {
    out.set(r.contact.id, toChange(r.contact, r.companyName, "strong", "Emails to this address bounced.", null, r.at));
  }
  const nowInvalid = await db
    .select({ contact: c, companyName: schema.company.name })
    .from(c)
    .leftJoin(schema.company, eq(schema.company.id, c.companyId))
    .where(
      and(
        eq(c.organizationId, org),
        eq(c.emailStatus, "invalid"),
        sql`${c.stage} not in ('changed_job','do_not_contact')`,
        sql`exists (select 1 from ${schema.fieldProvenance} p where p.organization_id = ${org} and p.entity_type = 'contact' and p.entity_id = ${c.id} and p.field = 'emailStatus' and p.value = 'valid')`,
      ),
    )
    .limit(limit);
  for (const r of nowInvalid) {
    if (out.has(r.contact.id)) continue;
    out.set(
      r.contact.id,
      toChange(
        r.contact,
        r.companyName,
        "strong",
        "The address verified before and now fails.",
        null,
        r.contact.emailVerifiedAt,
      ),
    );
  }

  // 2) Team pages: compare the latest crawl that found people with the contact list.
  const crawls = await db
    .select({
      id: schema.crawlJob.id,
      companyId: schema.crawlJob.companyId,
      result: schema.crawlJob.result,
      finishedAt: schema.crawlJob.finishedAt,
    })
    .from(schema.crawlJob)
    .where(
      and(
        eq(schema.crawlJob.organizationId, org),
        eq(schema.crawlJob.status, "completed"),
        isNotNull(schema.crawlJob.companyId),
        sql`jsonb_array_length(coalesce(${schema.crawlJob.result}->'people', '[]'::jsonb)) > 0`,
      ),
    )
    .orderBy(desc(schema.crawlJob.finishedAt))
    .limit(500);
  const byCompany = new Map<string, Array<{ names: Set<string>; finishedAt: Date | null; url: string | null }>>();
  for (const crawl of crawls) {
    if (!crawl.companyId) continue;
    const findings = crawl.result as unknown as CrawlFindings | null;
    const people = Array.isArray(findings?.people) ? findings.people : [];
    const names = new Set(people.map((p) => `${norm(p.firstName)}|${norm(p.lastName)}`));
    const list = byCompany.get(crawl.companyId) ?? [];
    list.push({ names, finishedAt: crawl.finishedAt, url: people[0]?.sourceUrl ?? null });
    byCompany.set(crawl.companyId, list);
  }
  if (byCompany.size) {
    const rows = await db
      .select({ contact: c, companyName: schema.company.name })
      .from(c)
      .leftJoin(schema.company, eq(schema.company.id, c.companyId))
      .where(
        and(
          eq(c.organizationId, org),
          inArray(c.companyId, [...byCompany.keys()]),
          isNotNull(c.firstName),
          isNotNull(c.lastName),
          sql`${c.stage} not in ('changed_job','do_not_contact')`,
        ),
      )
      .limit(5000);
    for (const r of rows) {
      if (out.has(r.contact.id) || !r.contact.companyId) continue;
      const history = byCompany.get(r.contact.companyId) ?? [];
      const latest = history[0];
      if (!latest?.finishedAt || latest.finishedAt < r.contact.createdAt) continue;
      const key = `${norm(r.contact.firstName)}|${norm(r.contact.lastName)}`;
      if (latest.names.has(key)) continue;
      const listedBefore = history.slice(1).some((h) => h.names.has(key));
      out.set(
        r.contact.id,
        toChange(
          r.contact,
          r.companyName,
          listedBefore ? "strong" : "hint",
          listedBefore
            ? "Listed on the team page in an earlier crawl, missing from the latest one."
            : "Not listed on the company's team page in the latest crawl.",
          latest.url,
          latest.finishedAt,
        ),
      );
    }
  }
  // Strong signals first, newest first within each group.
  const rank = (c: JobChange) => (c.signal === "strong" ? 0 : 1);
  return [...out.values()]
    .sort((a, b) => rank(a) - rank(b) || b.detectedAt.localeCompare(a.detectedAt))
    .slice(0, limit);
}

function toChange(
  contact: ContactRow,
  companyName: string | null,
  signal: JobChange["signal"],
  reason: string,
  sourceUrl: string | null,
  at: Date | string | null,
): JobChange {
  const when = at ? new Date(at) : contact.updatedAt;
  return {
    contactId: contact.id,
    name: contactName(contact),
    email: contact.email,
    title: contact.title,
    companyId: contact.companyId,
    companyName,
    stage: contact.stage,
    signal,
    reason,
    sourceUrl,
    detectedAt: (Number.isNaN(when.getTime()) ? contact.updatedAt : when).toISOString(),
  };
}
