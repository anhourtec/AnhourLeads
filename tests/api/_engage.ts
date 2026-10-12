/**
 * Fixtures for the lists, sequences and mailboxes specs: direct database inserts for records owned
 * by other features (contacts, companies, suppressions) and a small Mailpit client.
 */
import { type APIRequestContext, expect, request } from "@playwright/test";
import { Pool } from "pg";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(__dirname, "../../.env"), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "").trim();
  } catch {
    // fall through to the docker compose default
  }
  return "postgres://anhour:anhour_dev_password@127.0.0.1:48432/anhourleads";
}

let pool: Pool | undefined;
export function pg(): Pool {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 2 });
  return pool;
}

export const uniq = (prefix = "t") => `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

const orgIds = new Map<string, string>();
export async function orgId(slug: "acme" | "globex"): Promise<string> {
  const cached = orgIds.get(slug);
  if (cached) return cached;
  const { rows } = await pg().query<{ id: string }>("select id from organization where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`workspace ${slug} not seeded`);
  orgIds.set(slug, rows[0].id);
  return rows[0].id;
}

export interface ContactFixture {
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  email?: string | null;
  emailStatus?: string;
  stage?: string;
  country?: string | null;
  seniority?: string | null;
  companyId?: string | null;
}

export async function createContact(slug: "acme" | "globex", fields: ContactFixture = {}): Promise<string> {
  const id = randomUUID();
  const tag = uniq("c");
  await pg().query(
    `insert into contact (id, organization_id, first_name, last_name, title, email, email_status, stage, country, seniority, company_id, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'test')`,
    [
      id,
      await orgId(slug),
      "firstName" in fields ? fields.firstName : "Test",
      "lastName" in fields ? fields.lastName : "Person",
      "title" in fields ? fields.title : "Head of testing",
      "email" in fields ? fields.email : `${tag}@example.test`,
      fields.emailStatus ?? "valid",
      fields.stage ?? "new",
      fields.country ?? null,
      fields.seniority ?? null,
      fields.companyId ?? null,
    ],
  );
  return id;
}

export async function createCompany(
  slug: "acme" | "globex",
  fields: { name?: string; industry?: string; country?: string; employeeCount?: number } = {},
): Promise<string> {
  const id = randomUUID();
  const tag = uniq("co");
  await pg().query(
    `insert into company (id, organization_id, name, domain, industry, country, employee_count, source)
     values ($1, $2, $3, $4, $5, $6, $7, 'test')`,
    [
      id,
      await orgId(slug),
      fields.name ?? `Company ${tag}`,
      `${tag}.example.test`,
      fields.industry ?? null,
      fields.country ?? null,
      fields.employeeCount ?? null,
    ],
  );
  return id;
}

export async function suppress(slug: "acme" | "globex", kind: "email" | "domain", value: string): Promise<void> {
  await pg().query(
    `insert into suppression (id, organization_id, kind, value, reason) values ($1, $2, $3, $4, 'manual')
     on conflict do nothing`,
    [randomUUID(), await orgId(slug), kind, value.toLowerCase()],
  );
}

export async function suppressionExists(slug: "acme" | "globex", email: string): Promise<string | null> {
  const { rows } = await pg().query<{ reason: string }>(
    "select reason from suppression where organization_id = $1 and kind = 'email' and value = $2",
    [await orgId(slug), email.toLowerCase()],
  );
  return rows[0]?.reason ?? null;
}

/** Mailbox settings that deliver to the local Mailpit. */
export function mailpitMailbox(overrides: Record<string, unknown> = {}) {
  return {
    email: `${uniq("sender")}@acme.test`,
    provider: "smtp",
    displayName: "Acme Sender",
    dailyLimit: 50,
    sendingWindowStart: "00:00",
    sendingWindowEnd: "23:59",
    timezone: "UTC",
    smtpHost: "127.0.0.1",
    smtpPort: 48025,
    smtpSecure: "none",
    postalAddress: "1 Test Street, Springfield, 12345",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Mailpit                                                                    */
/* -------------------------------------------------------------------------- */

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:48026";

let mailpitCtx: Promise<APIRequestContext> | undefined;
const mailpit = () => {
  mailpitCtx ??= request.newContext({ baseURL: MAILPIT });
  return mailpitCtx;
};

export interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function mailpitSearch(query: string): Promise<MailpitSummary[]> {
  const ctx = await mailpit();
  const res = await ctx.get("/api/v1/search", { params: { query } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { messages: MailpitSummary[] }).messages;
}

export async function mailpitWaitFor(query: string, n = 1): Promise<MailpitSummary[]> {
  let found: MailpitSummary[] = [];
  await expect
    .poll(
      async () => {
        found = await mailpitSearch(query);
        return found.length;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(n);
  return found;
}

export async function mailpitMessage(id: string): Promise<{ Text: string; Subject: string }> {
  const ctx = await mailpit();
  const res = await ctx.get(`/api/v1/message/${id}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export async function mailpitHeaders(id: string): Promise<Record<string, string[] | undefined>> {
  const ctx = await mailpit();
  const res = await ctx.get(`/api/v1/message/${id}/headers`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}
