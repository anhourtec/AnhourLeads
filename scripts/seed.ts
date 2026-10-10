/**
 * Seed demo data. `npm run db:seed` (idempotent: skips when the demo workspace exists)
 * or `npm run db:seed -- --reset` (truncates every table first; used by the test harness).
 *
 * Creates the platform administrator (SEED_PLATFORM_ADMIN_*), workspace "Acme Outbound" with one
 * account per role, a second workspace "Globex" for cross-tenant isolation checks, and sample data.
 * Every demo account uses the password DEMO_PASSWORD.
 */
import "dotenv/config";

import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import { Pool } from "pg";

import * as schema from "../src/server/db/schema";
import { randomBytes } from "node:crypto";

export const DEMO_PASSWORD = "demo-password-1234";
export const DEMO_ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const id = () => crypto.randomUUID();

async function createUser(email: string, name: string, password: string, role: "user" | "admin" = "user") {
  const userId = id();
  await db.insert(schema.user).values({ id: userId, email, name, emailVerified: true, role });
  await db.insert(schema.account).values({
    id: id(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
  });
  return userId;
}

async function createWorkspace(name: string, slug: string, brand: Partial<typeof schema.organization.$inferInsert>) {
  const organizationId = id();
  await db.insert(schema.organization).values({ id: organizationId, name, slug, ...brand });
  return organizationId;
}

async function addMember(organizationId: string, userId: string, role: string) {
  await db.insert(schema.member).values({ id: id(), organizationId, userId, role });
}

async function reset() {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  // Cached tenants, brands and rate-limit counters refer to the old rows.
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    const keys = await redis.keys("anhour:*");
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  }
}

const COMPANIES = [
  {
    name: "Northwind Analytics",
    domain: "northwind.example",
    industry: "Software",
    employeeCount: 240,
    city: "Toronto",
    country: "Canada",
  },
  {
    name: "Bluebird Logistics",
    domain: "bluebird.example",
    industry: "Logistics",
    employeeCount: 1200,
    city: "Chicago",
    country: "United States",
  },
  {
    name: "Cedar Health",
    domain: "cedarhealth.example",
    industry: "Healthcare",
    employeeCount: 85,
    city: "Austin",
    country: "United States",
  },
  {
    name: "Lumen Robotics",
    domain: "lumen.example",
    industry: "Manufacturing",
    employeeCount: 430,
    city: "Munich",
    country: "Germany",
  },
  {
    name: "Harbor Finance",
    domain: "harbor.example",
    industry: "Financial Services",
    employeeCount: 60,
    city: "London",
    country: "United Kingdom",
  },
  {
    name: "Quartz Security",
    domain: "quartz.example",
    industry: "Cybersecurity",
    employeeCount: 150,
    city: "Vancouver",
    country: "Canada",
  },
  {
    name: "Fernhill Retail",
    domain: "fernhill.example",
    industry: "Retail",
    employeeCount: 3100,
    city: "Sydney",
    country: "Australia",
  },
  {
    name: "Atlas Energy",
    domain: "atlas-energy.example",
    industry: "Energy",
    employeeCount: 900,
    city: "Calgary",
    country: "Canada",
  },
] as const;

const PEOPLE = [
  ["Maya", "Chen", "VP of Sales", "vp", "Sales"],
  ["Daniel", "Okafor", "Head of Revenue Operations", "head", "Operations"],
  ["Priya", "Raman", "Chief Technology Officer", "c_suite", "Engineering"],
  ["Lucas", "Martin", "Sales Development Manager", "manager", "Sales"],
  ["Sofia", "Rossi", "Director of Marketing", "director", "Marketing"],
  ["Ethan", "Walker", "Account Executive", "senior", "Sales"],
  ["Aisha", "Khan", "Founder & CEO", "founder", "Executive"],
  ["Noah", "Fischer", "IT Manager", "manager", "Engineering"],
  ["Emma", "Dubois", "Procurement Lead", "senior", "Operations"],
  ["Kenji", "Watanabe", "Head of Growth", "head", "Marketing"],
] as const;

function seedEmailStatus(i: number): "unverified" | "catch_all" | "valid" {
  if (i % 5 === 0) return "unverified";
  if (i % 7 === 0) return "catch_all";
  return "valid";
}

async function seedAcmeData(organizationId: string, owners: Record<(typeof DEMO_ROLES)[number], string>) {
  const companyIds: string[] = [];
  for (const c of COMPANIES) {
    const companyId = id();
    companyIds.push(companyId);
    await db.insert(schema.company).values({
      id: companyId,
      organizationId,
      ...c,
      websiteUrl: `https://${c.domain}`,
      emailPattern: "{first}.{last}",
      ownerId: owners.member,
      stage: "prospect",
      source: "seed",
    });
  }

  const contactIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    const [first, last, title, seniority, department] = PEOPLE[i % PEOPLE.length];
    const companyIndex = i % COMPANIES.length;
    const contactId = id();
    contactIds.push(contactId);
    const email = `${first}.${last}${i >= PEOPLE.length ? i : ""}@${COMPANIES[companyIndex].domain}`.toLowerCase();
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      companyId: companyIds[companyIndex],
      firstName: first,
      lastName: last,
      title,
      seniority,
      department,
      email,
      emailStatus: seedEmailStatus(i),
      city: COMPANIES[companyIndex].city,
      country: COMPANIES[companyIndex].country,
      ownerId: i % 2 === 0 ? owners.member : owners.manager,
      stage: i % 6 === 0 ? "replied" : "new",
      source: "seed",
      consentBasis: "legitimate_interest",
    });
    await db.insert(schema.fieldProvenance).values({
      organizationId,
      entityType: "contact",
      entityId: contactId,
      field: "email",
      value: email,
      source: "csv_import",
      confidence: 0.9,
    });
  }

  const listId = id();
  await db.insert(schema.list).values({
    id: listId,
    organizationId,
    name: "Q4 target accounts — sales leaders",
    entityType: "contact",
    createdById: owners.manager,
  });
  await db.insert(schema.listMember).values(contactIds.slice(0, 8).map((entityId) => ({ listId, entityId })));

  const mailboxId = id();
  await db.insert(schema.mailbox).values({
    id: mailboxId,
    organizationId,
    userId: owners.member,
    email: "member@acme.test",
    provider: "smtp",
    displayName: "Acme Member",
    dailyLimit: 40,
  });

  const sequenceId = id();
  await db.insert(schema.sequence).values({
    id: sequenceId,
    organizationId,
    name: "Sales leaders — intro",
    status: "active",
    mailboxId,
    createdById: owners.manager,
  });
  await db.insert(schema.sequenceStep).values([
    {
      sequenceId,
      position: 1,
      type: "auto_email",
      waitDays: 0,
      subject: "Quick question, {{first_name}}",
      body: "Hi {{first_name}},\n\n…",
    },
    {
      sequenceId,
      position: 2,
      type: "auto_email",
      waitDays: 3,
      subject: "Re: Quick question, {{first_name}}",
      body: "Following up…",
    },
    { sequenceId, position: 3, type: "call", waitDays: 2, body: "Call and reference the email thread." },
  ]);
  await db
    .insert(schema.enrollment)
    .values(
      contactIds
        .slice(0, 5)
        .map((contactId) => ({ organizationId, sequenceId, contactId, enrolledById: owners.member })),
    );

  const now = Date.now();
  await db.insert(schema.task).values([
    {
      organizationId,
      assigneeId: owners.member,
      contactId: contactIds[0],
      type: "call",
      priority: "high",
      title: "Call Maya about pilot",
      dueAt: new Date(now + 864e5),
    },
    {
      organizationId,
      assigneeId: owners.member,
      contactId: contactIds[1],
      type: "email",
      title: "Send case study",
      dueAt: new Date(now + 2 * 864e5),
    },
    {
      organizationId,
      assigneeId: owners.manager,
      companyId: companyIds[2],
      type: "action_item",
      title: "Review Cedar Health account plan",
    },
  ]);

  await db.insert(schema.deal).values([
    {
      organizationId,
      name: "Northwind — annual plan",
      companyId: companyIds[0],
      contactId: contactIds[0],
      ownerId: owners.member,
      stage: "proposal",
      amount: 48000,
    },
    {
      organizationId,
      name: "Bluebird — pilot",
      companyId: companyIds[1],
      contactId: contactIds[1],
      ownerId: owners.manager,
      stage: "meeting",
      amount: 12000,
    },
    {
      organizationId,
      name: "Lumen — expansion",
      companyId: companyIds[3],
      ownerId: owners.admin,
      stage: "won",
      amount: 90000,
    },
  ]);

  await db.insert(schema.suppression).values([
    { organizationId, kind: "domain", value: "competitor.example", reason: "manual", note: "Competitor" },
    { organizationId, kind: "email", value: "unsubscribed@harbor.example", reason: "unsubscribed" },
  ]);
}

async function main() {
  if (process.argv.includes("--reset")) await reset();

  const [existing] = await db.select().from(schema.organization).where(eq(schema.organization.slug, "acme")).limit(1);
  if (existing) {
    console.log("demo data already present (use --reset to start over)");
    return;
  }

  const adminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL ?? "admin@anhourleads.local";
  const adminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD ?? DEMO_PASSWORD;
  const platformAdmin = await createUser(adminEmail, "Platform Admin", adminPassword, "admin");
  const hq = await createWorkspace("Anhour HQ", "anhour-hq", {});
  await addMember(hq, platformAdmin, "owner");

  const acme = await createWorkspace("Acme Outbound", "acme", {
    brandName: "Acme Prospecting",
    brandColor: "emerald",
    supportEmail: "support@acme.test",
    hostnameLimit: 3,
  });
  const owners = {} as Record<(typeof DEMO_ROLES)[number], string>;
  for (const role of DEMO_ROLES) {
    owners[role] = await createUser(
      `${role}@acme.test`,
      `Acme ${role[0].toUpperCase()}${role.slice(1)}`,
      DEMO_PASSWORD,
    );
    await addMember(acme, owners[role], role);
  }
  await db.insert(schema.workspaceDomain).values({
    organizationId: acme,
    hostname: "acme.localhost:3410",
    status: "verified",
    verificationToken: randomBytes(24).toString("base64url"),
    verifiedAt: new Date(),
    createdById: owners.owner,
  });
  await seedAcmeData(acme, owners);

  const globex = await createWorkspace("Globex", "globex", {});
  const globexOwner = await createUser("owner@globex.test", "Globex Owner", DEMO_PASSWORD);
  await addMember(globex, globexOwner, "owner");
  await db.insert(schema.company).values({
    organizationId: globex,
    name: "Globex Secret Prospect",
    domain: "secret.example",
    source: "seed",
  });

  console.log(
    `seeded: platform admin ${adminEmail}; acme (${DEMO_ROLES.map((r) => `${r}@acme.test`).join(", ")}); owner@globex.test`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
