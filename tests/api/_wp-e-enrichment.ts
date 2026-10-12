/** Direct inserts for the data health and duplicates specs (records other features own). */

import { orgId, pg } from "./_engage";
import { randomUUID } from "node:crypto";

type Slug = "acme" | "globex";

export async function insertCompany(slug: Slug, fields: { name: string; domain?: string | null; industry?: string }) {
  const id = randomUUID();
  await pg().query(
    "insert into company (id, organization_id, name, domain, industry, source) values ($1, $2, $3, $4, $5, 'test')",
    [id, await orgId(slug), fields.name, fields.domain ?? null, fields.industry ?? null],
  );
  return id;
}

export async function insertPerson(
  slug: Slug,
  fields: {
    firstName: string;
    lastName: string;
    companyId?: string | null;
    email?: string | null;
    title?: string | null;
    phone?: string | null;
    city?: string | null;
    linkedinUrl?: string | null;
    createdDaysAgo?: number;
  },
) {
  const id = randomUUID();
  await pg().query(
    `insert into contact (id, organization_id, first_name, last_name, company_id, email, title, phone, city, linkedin_url, source, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'test', now() - make_interval(days => $11))`,
    [
      id,
      await orgId(slug),
      fields.firstName,
      fields.lastName,
      fields.companyId ?? null,
      fields.email ?? null,
      fields.title ?? null,
      fields.phone ?? null,
      fields.city ?? null,
      fields.linkedinUrl ?? null,
      fields.createdDaysAgo ?? 0,
    ],
  );
  return id;
}

export async function insertList(slug: Slug, entityType: "contact" | "company", memberIds: string[]) {
  const id = randomUUID();
  await pg().query("insert into list (id, organization_id, name, entity_type) values ($1, $2, $3, $4)", [
    id,
    await orgId(slug),
    `Merge list ${id.slice(0, 6)}`,
    entityType,
  ]);
  for (const m of memberIds) await pg().query("insert into list_member (list_id, entity_id) values ($1, $2)", [id, m]);
  return id;
}

export async function insertTask(slug: Slug, contactId: string) {
  const id = randomUUID();
  await pg().query("insert into task (id, organization_id, title, contact_id) values ($1, $2, 'Follow up', $3)", [
    id,
    await orgId(slug),
    contactId,
  ]);
  return id;
}

export async function insertNote(slug: Slug, entityType: "contact" | "company", entityId: string) {
  const id = randomUUID();
  await pg().query(
    "insert into note (id, organization_id, entity_type, entity_id, body) values ($1, $2, $3, $4, 'Met at the fair')",
    [id, await orgId(slug), entityType, entityId],
  );
  return id;
}

export async function insertBounce(slug: Slug, contactId: string, email: string) {
  await pg().query(
    "insert into outbound_message (id, organization_id, contact_id, to_email, subject, body, status) values ($1, $2, $3, $4, 'Hi', 'Hello', 'bounced')",
    [randomUUID(), await orgId(slug), contactId, email],
  );
}

export async function insertCrawl(
  slug: Slug,
  companyId: string,
  people: Array<{ firstName: string; lastName: string }>,
  finishedDaysAgo: number,
) {
  const id = randomUUID();
  const result = {
    seedUrl: "https://team.example.test/",
    domain: "team.example.test",
    facts: [],
    emails: [],
    phones: [],
    social: [],
    technologies: [],
    hiring: { careersUrl: null, jobCount: null, ats: [], mentions: [] },
    robots: null,
    emailPattern: null,
    suppressedEmails: 0,
    people: people.map((p) => ({
      ...p,
      name: `${p.firstName} ${p.lastName}`,
      title: null,
      sourceUrl: "https://team.example.test/team",
      method: "markup",
      confidence: 0.7,
      linkedinUrl: null,
      email: null,
    })),
  };
  await pg().query(
    `insert into crawl_job (id, organization_id, company_id, seed_url, status, result, finished_at, created_at)
     values ($1, $2, $3, 'https://team.example.test/', 'completed', $4, now() - make_interval(days => $5), now() - make_interval(days => $5))`,
    [id, await orgId(slug), companyId, JSON.stringify(result), finishedDaysAgo],
  );
  return id;
}
