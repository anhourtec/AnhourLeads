import "server-only";

import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";

import { can } from "@/lib/rbac/permissions";
import { matchesSettingsQuery, settingsFor } from "@/navigation/settings/settings-items";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";

import { likePattern } from "./records";

export const globalSearchSchema = z.object({ q: z.string().trim().min(1).max(100) });

const PER_GROUP = 5;

export interface GlobalSearchResult {
  people: { id: string; name: string; title: string | null; company: string | null; stage: string }[];
  companies: { id: string; name: string; employeeCount: number | null; industry: string | null; stage: string }[];
  settings: { id: string; title: string; section: string; url: string }[];
}

/**
 * The command palette's search: up to five people, five companies and the settings pages that
 * match, all from the actor's workspace. Record groups need their read permission; settings pages
 * are filtered by the role the same way the settings sidebar is.
 */
export async function globalSearch(actor: Actor, query: string): Promise<GlobalSearchResult> {
  const pattern = likePattern(query);
  const { contact, company } = schema;
  const fullName = sql<string>`trim(coalesce(${contact.firstName}, '') || ' ' || coalesce(${contact.lastName}, ''))`;

  const [people, companies] = await Promise.all([
    can(actor.role, "contact:read")
      ? db
          .select({
            id: contact.id,
            name: fullName,
            email: contact.email,
            title: contact.title,
            company: company.name,
            stage: contact.stage,
          })
          .from(contact)
          .leftJoin(company, and(eq(company.id, contact.companyId), eq(company.organizationId, actor.organizationId)))
          .where(
            and(
              eq(contact.organizationId, actor.organizationId),
              or(ilike(fullName, pattern), ilike(contact.email, pattern), ilike(contact.title, pattern)),
            ),
          )
          .orderBy(asc(contact.firstName), asc(contact.lastName))
          .limit(PER_GROUP)
      : Promise.resolve([]),
    can(actor.role, "company:read")
      ? db
          .select({
            id: company.id,
            name: company.name,
            employeeCount: company.employeeCount,
            industry: company.industry,
            stage: company.stage,
          })
          .from(company)
          .where(
            and(
              eq(company.organizationId, actor.organizationId),
              or(ilike(company.name, pattern), ilike(company.domain, pattern)),
            ),
          )
          .orderBy(asc(company.name))
          .limit(PER_GROUP)
      : Promise.resolve([]),
  ]);

  const settings = settingsFor(actor.role)
    .flatMap((group) =>
      group.links
        .filter((link) => matchesSettingsQuery(link, group, query))
        .map((link) => ({ id: link.id, title: link.title, section: group.title, url: link.url })),
    )
    .slice(0, PER_GROUP);

  return {
    people: people.map(({ email, ...p }) => ({ ...p, name: p.name || email || "Unnamed person" })),
    companies,
    settings,
  };
}
