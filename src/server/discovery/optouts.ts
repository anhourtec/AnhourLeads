import "server-only";

import { and, count, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";

import { domainFromInput } from "@/server/crawler/url";
import { db, schema } from "@/server/db";

import { bareDomain, personOptoutKey } from "./classify";

/**
 * Opt-outs from the discovery index (index_optout). Honoured everywhere: the crawler never adds an
 * opted-out domain, person or address again, search and "save to workspace" leave them out, and the
 * sending engine can ask `isOptedOut()` before it emails anyone. Adding one deletes what the index
 * already holds about it.
 */
export type OptoutKind = "domain" | "email" | "person";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeOptoutDomain(value: string): string | null {
  const domain = domainFromInput(value);
  return domain ? bareDomain(domain) : null;
}

export function normalizeOptoutEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** "Jane Doe|acme.com" (or a name and a domain) → normalised person key. */
export function normalizeOptoutPerson(fullName: string, domain: string): string | null {
  const name = fullName.trim().replace(/\s+/g, " ");
  const d = normalizeOptoutDomain(domain);
  if (name.length < 2 || name.length > 160 || !d) return null;
  return personOptoutKey(name, d);
}

/** The domain and its parents: mail.acme.co.uk → [mail.acme.co.uk, acme.co.uk, co.uk]. */
function domainChain(domain: string): string[] {
  const labels = bareDomain(domain).split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out.length ? out : [bareDomain(domain)];
}

export interface OptoutQuery {
  email?: string | null;
  domain?: string | null;
  fullName?: string | null;
}

/**
 * True when the address, the domain (or a parent domain) or the person at that domain asked to be
 * left out of the index. One query. Callers outside discovery (e.g. the sending engine) use this
 * through src/server/services/discovery.ts.
 */
export async function isOptedOut(query: OptoutQuery): Promise<boolean> {
  const conditions: SQL[] = [];
  const email = query.email ? normalizeOptoutEmail(query.email) : null;
  const domains = new Set<string>();
  if (query.domain) for (const d of domainChain(query.domain)) domains.add(d);
  if (email) {
    conditions.push(and(eq(schema.indexOptout.kind, "email"), eq(schema.indexOptout.value, email)) as SQL);
    for (const d of domainChain(email.split("@")[1] ?? "")) domains.add(d);
  }
  if (domains.size) {
    conditions.push(and(eq(schema.indexOptout.kind, "domain"), inArray(schema.indexOptout.value, [...domains])) as SQL);
  }
  const personDomain = query.domain ?? email?.split("@")[1] ?? null;
  if (query.fullName && personDomain) {
    const key = normalizeOptoutPerson(query.fullName, personDomain);
    if (key) conditions.push(and(eq(schema.indexOptout.kind, "person"), eq(schema.indexOptout.value, key)) as SQL);
  }
  if (!conditions.length) return false;
  const [row] = await db
    .select({ id: schema.indexOptout.id })
    .from(schema.indexOptout)
    .where(or(...conditions))
    .limit(1);
  return Boolean(row);
}

/** SQL: the index company row is not opted out by domain (outer tables named explicitly for correlation). */
export function companyNotOptedOutSql(): SQL {
  return sql`not exists (
    select 1 from ${schema.indexOptout} o
    where o.kind = 'domain'
      and (split_part("index_company"."domain", ':', 1) = o.value
        or split_part("index_company"."domain", ':', 1) like '%.' || o.value)
  )`;
}

/** SQL: the index person is not opted out by name or by published address. */
export function personNotOptedOutSql(): SQL {
  return sql`not exists (
    select 1 from ${schema.indexOptout} o
    where (o.kind = 'email' and o.value = lower(coalesce("index_person"."published_email", '')))
       or (o.kind = 'person'
           and o.value = lower(regexp_replace(trim("index_person"."full_name"), '\\s+', ' ', 'g'))
             || '|' || split_part("index_company"."domain", ':', 1))
  )`;
}

export interface OptoutView {
  id: string;
  kind: OptoutKind;
  value: string;
  reason: string | null;
  requestedBy: string | null;
  createdAt: string;
}

function view(row: typeof schema.indexOptout.$inferSelect): OptoutView {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    reason: row.reason,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Delete what the index holds about an opt-out and stop crawling it. Returns rows removed. */
export async function purgeForOptout(kind: OptoutKind, value: string): Promise<{ companies: number; people: number }> {
  if (kind === "domain") {
    const host = sql`split_part(${schema.indexCompany.domain}, ':', 1)`;
    const removed = await db
      .delete(schema.indexCompany)
      .where(sql`${host} = ${value} or ${host} like ${`%.${value}`}`)
      .returning({ id: schema.indexCompany.id });
    const frontierHost = sql`split_part(${schema.crawlFrontier.host}, ':', 1)`;
    await db
      .update(schema.crawlFrontier)
      .set({ status: "skipped", skippedReason: "opted_out" })
      .where(
        and(
          inArray(schema.crawlFrontier.status, ["queued", "done", "failed"]),
          sql`(${frontierHost} = ${value} or ${frontierHost} like ${`%.${value}`})`,
        ),
      );
    return { companies: removed.length, people: 0 };
  }
  if (kind === "email") {
    const removed = await db
      .delete(schema.indexPerson)
      .where(sql`lower(${schema.indexPerson.publishedEmail}) = ${value}`)
      .returning({ id: schema.indexPerson.id });
    return { companies: 0, people: removed.length };
  }
  const [name, domain] = value.split("|");
  if (!name || !domain) return { companies: 0, people: 0 };
  const removed = await db
    .delete(schema.indexPerson)
    .where(
      sql`lower(regexp_replace(trim(${schema.indexPerson.fullName}), '\\s+', ' ', 'g')) = ${name}
        and ${schema.indexPerson.companyId} in (
          select ${schema.indexCompany.id} from ${schema.indexCompany}
          where split_part(${schema.indexCompany.domain}, ':', 1) = ${domain})`,
    )
    .returning({ id: schema.indexPerson.id });
  return { companies: 0, people: removed.length };
}

export async function addOptout(input: {
  kind: OptoutKind;
  value: string;
  reason?: string | null;
  requestedBy?: string | null;
}): Promise<{ optout: OptoutView; created: boolean; removed: { companies: number; people: number } }> {
  const inserted = await db
    .insert(schema.indexOptout)
    .values({
      kind: input.kind,
      value: input.value,
      reason: input.reason ?? null,
      requestedBy: input.requestedBy ?? null,
    })
    .onConflictDoNothing()
    .returning();
  const row =
    inserted[0] ??
    (
      await db
        .select()
        .from(schema.indexOptout)
        .where(and(eq(schema.indexOptout.kind, input.kind), eq(schema.indexOptout.value, input.value)))
        .limit(1)
    )[0];
  if (!row) throw new Error("opt-out insert failed");
  const removed = await purgeForOptout(input.kind, input.value);
  return { optout: view(row), created: Boolean(inserted[0]), removed };
}

export async function removeOptout(id: string): Promise<OptoutView | null> {
  const [row] = await db.delete(schema.indexOptout).where(eq(schema.indexOptout.id, id)).returning();
  return row ? view(row) : null;
}

export async function listOptouts(
  filters: { q?: string; kind?: OptoutKind },
  page: { perPage: number; offset: number },
) {
  const where = and(
    filters.kind ? eq(schema.indexOptout.kind, filters.kind) : undefined,
    filters.q ? ilike(schema.indexOptout.value, `%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(schema.indexOptout)
      .where(where)
      .orderBy(desc(schema.indexOptout.createdAt))
      .limit(page.perPage)
      .offset(page.offset),
    db.select({ n: count() }).from(schema.indexOptout).where(where),
  ]);
  return { optouts: rows.map(view), total: Number(total?.n ?? 0) };
}
