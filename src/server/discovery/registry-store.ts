import "server-only";

import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";

import { db, schema } from "@/server/db";

import { departmentFromTitle, seniorityFromTitle, splitFullName } from "./classify";
import { isOptedOut } from "./optouts";
import { matchKeyForCompanyName, type RegistryKind, type RegistryOfficer } from "./registries";

/**
 * Index writes for the official registries (Companies House, SEC EDGAR): registry ids on index
 * companies and officers as index people. Companies themselves are upserted through
 * index-store.ts `upsertIndexCompany` (by domain); this module only adds what is registry-specific.
 */

type CompanyRow = typeof schema.indexCompany.$inferSelect;

const idColumn = (kind: RegistryKind) =>
  kind === "companies_house" ? schema.indexCompany.companiesHouseNumber : schema.indexCompany.secCik;

export function registryIdOf(company: CompanyRow, kind: RegistryKind): string | null {
  return kind === "companies_house" ? company.companiesHouseNumber : company.secCik;
}

export async function companyByRegistryId(kind: RegistryKind, id: string): Promise<CompanyRow | null> {
  const [row] = await db
    .select()
    .from(schema.indexCompany)
    .where(eq(idColumn(kind), id))
    .limit(1);
  return row ?? null;
}

/**
 * Record the registry id on a company that has none yet. False when the company already holds a
 * different id (two registered companies sharing one website) or another company holds this id.
 */
export async function attachRegistryId(company: CompanyRow, kind: RegistryKind, id: string): Promise<boolean> {
  const current = registryIdOf(company, kind);
  if (current) return current === id;
  const column = idColumn(kind);
  try {
    const updated = await db
      .update(schema.indexCompany)
      .set(kind === "companies_house" ? { companiesHouseNumber: id } : { secCik: id })
      .where(and(eq(schema.indexCompany.id, company.id), isNull(column)))
      .returning({ id: schema.indexCompany.id });
    if (updated.length) return true;
  } catch {
    // Unique violation: another company already holds this id.
    return false;
  }
  const fresh = await db.select({ v: column }).from(schema.indexCompany).where(eq(schema.indexCompany.id, company.id));
  return fresh[0]?.v === id;
}

/**
 * Index companies by normalised name, for exact-name matching of registry companies that have no
 * known website. Only companies without an id from this registry take part; a name shared by
 * several companies is ambiguous and never matched.
 */
export class NameMatcher {
  private byName: Map<string, CompanyRow[]> | null = null;

  constructor(private readonly kind: RegistryKind) {}

  private async load(): Promise<Map<string, CompanyRow[]>> {
    if (this.byName) return this.byName;
    const rows = await db
      .select()
      .from(schema.indexCompany)
      .where(and(isNotNull(schema.indexCompany.name), isNull(idColumn(this.kind))));
    const map = new Map<string, CompanyRow[]>();
    for (const row of rows) {
      const key = matchKeyForCompanyName(row.name);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    this.byName = map;
    return map;
  }

  /** The one company with exactly this (normalised) name, or null when none or several. */
  async match(name: string | null): Promise<CompanyRow | null> {
    const key = matchKeyForCompanyName(name);
    if (!key) return null;
    const list = (await this.load()).get(key);
    return list?.length === 1 ? (list[0] ?? null) : null;
  }

  /** Once a company has this registry's id it can't be matched for another. */
  claim(company: CompanyRow): void {
    const key = matchKeyForCompanyName(company.name);
    if (!key || !this.byName) return;
    const list = this.byName.get(key)?.filter((r) => r.id !== company.id);
    if (list?.length) this.byName.set(key, list);
    else this.byName.delete(key);
  }
}

export interface OfficerWrite {
  added: number;
  updated: number;
  optedOut: number;
  gone: number;
}

/**
 * Upsert a registry's current officers for one company (index_person keyed by company + full
 * name). With `markGone` (a complete list), officers this registry listed before but not any more
 * get `goneAt`. A person the crawler
 * found on the company's own pages keeps that source, page and title; only a missing title is
 * filled. Opted-out people are never written. Nothing but the name and role is stored.
 */
export async function recordRegistryOfficers(
  company: CompanyRow,
  kind: RegistryKind,
  officers: Array<RegistryOfficer & { sourceUrl: string }>,
  options: { markGone: boolean },
): Promise<OfficerWrite> {
  const now = new Date();
  const result: OfficerWrite = { added: 0, updated: 0, optedOut: 0, gone: 0 };
  const kept: string[] = [];
  for (const officer of officers.slice(0, 300)) {
    const fullName = officer.fullName.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!fullName) continue;
    if (await isOptedOut({ domain: company.domain, fullName })) {
      result.optedOut += 1;
      continue;
    }
    const split = splitFullName(fullName);
    const title = officer.title?.slice(0, 200) ?? null;
    const sameSource = sql`${schema.indexPerson.source} = excluded.source`;
    const [row] = await db
      .insert(schema.indexPerson)
      .values({
        companyId: company.id,
        fullName,
        firstName: split.firstName,
        lastName: split.lastName,
        title,
        seniority: seniorityFromTitle(title),
        department: departmentFromTitle(title),
        source: kind,
        sourceUrl: officer.sourceUrl,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.indexPerson.companyId, schema.indexPerson.fullName],
        set: {
          title: sql`case when ${sameSource} then excluded.title else coalesce(${schema.indexPerson.title}, excluded.title) end`,
          seniority: sql`case when ${sameSource} or ${schema.indexPerson.title} is null then excluded.seniority else ${schema.indexPerson.seniority} end`,
          department: sql`case when ${sameSource} or ${schema.indexPerson.title} is null then excluded.department else ${schema.indexPerson.department} end`,
          sourceUrl: sql`case when ${sameSource} then excluded.source_url else ${schema.indexPerson.sourceUrl} end`,
          lastSeenAt: now,
          goneAt: null,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    kept.push(fullName);
    if (row?.inserted) result.added += 1;
    else result.updated += 1;
  }
  if (!options.markGone) return result;
  const gone = await db
    .update(schema.indexPerson)
    .set({ goneAt: now })
    .where(
      and(
        eq(schema.indexPerson.companyId, company.id),
        eq(schema.indexPerson.source, kind),
        isNull(schema.indexPerson.goneAt),
        kept.length ? notInArray(schema.indexPerson.fullName, kept) : undefined,
      ),
    )
    .returning({ id: schema.indexPerson.id });
  result.gone = gone.length;
  return result;
}
