import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";

import { getCompany } from "./companies";
import { findingsOf } from "./research";

/**
 * What the company drawer and company page show beyond the record itself: the lists it's in,
 * where its people are, and people found on its website by the crawler who aren't contacts yet.
 */

export interface SuggestedPerson {
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  sourceUrl: string;
  confidence: number;
}

export interface CompanyInsights {
  lists: { id: string; name: string }[];
  peopleLocations: { location: string; count: number }[];
  suggestedPeople: SuggestedPerson[];
  lastCrawledAt: string | null;
}

export async function companyInsights(actor: Actor, companyId: string): Promise<CompanyInsights> {
  await getCompany(actor, companyId);
  const org = actor.organizationId;
  const [lists, locations, [job], contacts] = await Promise.all([
    db
      .select({ id: schema.list.id, name: schema.list.name })
      .from(schema.listMember)
      .innerJoin(schema.list, eq(schema.list.id, schema.listMember.listId))
      .where(and(eq(schema.list.organizationId, org), eq(schema.listMember.entityId, companyId)))
      .orderBy(schema.list.name),
    db
      .select({
        location: sql<string>`concat_ws(', ', ${schema.contact.city}, ${schema.contact.state}, ${schema.contact.country})`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.companyId, companyId)))
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`))
      .limit(20),
    db
      .select({ result: schema.crawlJob.result, finishedAt: schema.crawlJob.finishedAt })
      .from(schema.crawlJob)
      .where(
        and(
          eq(schema.crawlJob.organizationId, org),
          eq(schema.crawlJob.companyId, companyId),
          eq(schema.crawlJob.status, "completed"),
        ),
      )
      .orderBy(desc(schema.crawlJob.finishedAt))
      .limit(1),
    db
      .select({
        email: schema.contact.email,
        name: sql<string>`lower(concat_ws(' ', ${schema.contact.firstName}, ${schema.contact.lastName}))`,
      })
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.companyId, companyId))),
  ]);
  const knownEmails = new Set(contacts.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])));
  const knownNames = new Set(contacts.map((c) => c.name));
  const findings = job ? findingsOf(job) : null;
  const suggestedPeople: SuggestedPerson[] = (findings?.people ?? [])
    .filter((p) => !(p.email && knownEmails.has(p.email.toLowerCase())) && !knownNames.has(p.name.toLowerCase()))
    .slice(0, 50)
    .map((p) => ({
      name: p.name,
      title: p.title,
      email: p.email,
      linkedinUrl: p.linkedinUrl,
      sourceUrl: p.sourceUrl,
      confidence: p.confidence,
    }));
  return {
    lists,
    peopleLocations: locations.filter((l) => l.location).map((l) => ({ location: l.location, count: l.count })),
    suggestedPeople,
    lastCrawledAt: job?.finishedAt?.toISOString() ?? null,
  };
}
