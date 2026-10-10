import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/* Better Auth core + organization plugin tables                              */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Platform role (better-auth admin plugin): "admin" operates the whole installation. */
  role: text("role").notNull().default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A workspace. Better Auth calls it an organization. */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  /** White-label brand. Null fields fall back to the installation defaults (src/config/brand.ts). */
  brandName: text("brand_name"),
  brandColor: text("brand_color"),
  supportEmail: text("support_email"),
  hostnameLimit: integer("hostname_limit").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [index("member_org_idx").on(t.organizationId), index("member_user_idx").on(t.userId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* -------------------------------------------------------------------------- */
/* White-label hostnames                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A custom hostname that serves a workspace's brand. Does nothing until a DNS TXT record proves
 * ownership (pending → verified → failing → switched off after the grace period).
 */
export const workspaceDomain = pgTable(
  "workspace_domain",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    status: text("status", { enum: ["pending", "verified", "failing"] })
      .notNull()
      .default("pending"),
    verificationToken: text("verification_token").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    routing: text("routing", { enum: ["unknown", "pointed", "not_pointed"] })
      .notNull()
      .default("unknown"),
    certStatus: text("cert_status", { enum: ["none", "waiting", "active", "problem"] })
      .notNull()
      .default("none"),
    certExpiresAt: timestamp("cert_expires_at", { withTimezone: true }),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("domain_org_idx").on(t.organizationId)],
);

/* -------------------------------------------------------------------------- */
/* Platform: API keys, audit log, suppression                                 */
/* -------------------------------------------------------------------------- */

const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/** Workspace API keys. Only a SHA-256 hash of the secret is stored. */
export const apiKey = pgTable(
  "api_key",
  {
    id: id(),
    organizationId: orgId(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    role: text("role").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("api_key_org_idx").on(t.organizationId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: orgId(),
    actorUserId: text("actor_user_id"),
    actorApiKeyId: text("actor_api_key_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)],
);

/** Do-not-contact list. Matches an exact email or a whole domain. */
export const suppression = pgTable(
  "suppression",
  {
    id: id(),
    organizationId: orgId(),
    kind: text("kind", { enum: ["email", "domain"] }).notNull(),
    value: text("value").notNull(),
    reason: text("reason", { enum: ["unsubscribed", "bounced", "complaint", "manual", "erasure_request"] })
      .notNull()
      .default("manual"),
    note: text("note"),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppression_org_value_idx").on(t.organizationId, t.kind, t.value)],
);

/* -------------------------------------------------------------------------- */
/* Prospecting data: companies (accounts) and contacts (people)               */
/* -------------------------------------------------------------------------- */

export const company = pgTable(
  "company",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    domain: text("domain"),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    twitterUrl: text("twitter_url"),
    phone: text("phone"),
    industry: text("industry"),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    technologies: text("technologies").array().notNull().default(sql`'{}'::text[]`),
    employeeCount: integer("employee_count"),
    annualRevenue: integer("annual_revenue"),
    foundedYear: integer("founded_year"),
    description: text("description"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    emailPattern: text("email_pattern"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    stage: text("stage", { enum: ["cold", "prospect", "engaged", "customer", "churned"] })
      .notNull()
      .default("cold"),
    source: text("source").notNull().default("manual"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("company_org_idx").on(t.organizationId),
    uniqueIndex("company_org_domain_idx").on(t.organizationId, t.domain),
  ],
);

export const EMAIL_STATUSES = ["unverified", "valid", "invalid", "catch_all", "unknown", "role", "disposable"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const contact = pgTable(
  "contact",
  {
    id: id(),
    organizationId: orgId(),
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    seniority: text("seniority", {
      enum: [
        "owner",
        "founder",
        "c_suite",
        "partner",
        "vp",
        "head",
        "director",
        "manager",
        "senior",
        "entry",
        "intern",
      ],
    }),
    department: text("department"),
    email: text("email"),
    emailStatus: text("email_status", { enum: EMAIL_STATUSES }).notNull().default("unverified"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    timezone: text("timezone"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    stage: text("stage", {
      enum: ["new", "contacted", "replied", "interested", "not_interested", "unresponsive", "do_not_contact"],
    })
      .notNull()
      .default("new"),
    source: text("source").notNull().default("manual"),
    /** Lawful basis for contacting this person, e.g. "legitimate_interest" (GDPR) or "implied_consent" (CASL). */
    consentBasis: text("consent_basis"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contact_org_idx").on(t.organizationId),
    index("contact_company_idx").on(t.companyId),
    uniqueIndex("contact_org_email_idx").on(t.organizationId, t.email),
  ],
);

/** Where a field value came from and when it was last checked. */
export const fieldProvenance = pgTable(
  "field_provenance",
  {
    id: id(),
    organizationId: orgId(),
    entityType: text("entity_type", { enum: ["company", "contact"] }).notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    value: text("value"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    confidence: real("confidence").notNull().default(1),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provenance_entity_idx").on(t.entityType, t.entityId)],
);

/* -------------------------------------------------------------------------- */
/* Lists (Apollo "labels")                                                    */
/* -------------------------------------------------------------------------- */

export const list = pgTable(
  "list",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    entityType: text("entity_type", { enum: ["company", "contact"] }).notNull(),
    kind: text("kind", { enum: ["static", "dynamic"] })
      .notNull()
      .default("static"),
    /** Saved search filters for dynamic lists. */
    filters: jsonb("filters").$type<Record<string, unknown>>(),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("list_org_idx").on(t.organizationId)],
);

export const listMember = pgTable(
  "list_member",
  {
    listId: text("list_id")
      .notNull()
      .references(() => list.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.entityId] })],
);

/* -------------------------------------------------------------------------- */
/* Engagement: mailboxes, sequences, steps, enrollments                       */
/* -------------------------------------------------------------------------- */

export const mailbox = pgTable(
  "mailbox",
  {
    id: id(),
    organizationId: orgId(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    provider: text("provider", { enum: ["google", "microsoft", "smtp"] }).notNull(),
    displayName: text("display_name"),
    dailyLimit: integer("daily_limit").notNull().default(50),
    sendingWindowStart: text("sending_window_start").notNull().default("09:00"),
    sendingWindowEnd: text("sending_window_end").notNull().default("17:00"),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status", { enum: ["active", "paused", "disconnected", "warming"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("mailbox_org_email_idx").on(t.organizationId, t.email)],
);

export const sequence = pgTable(
  "sequence",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "active", "paused", "archived"] })
      .notNull()
      .default("draft"),
    mailboxId: text("mailbox_id").references(() => mailbox.id, { onDelete: "set null" }),
    trackOpens: boolean("track_opens").notNull().default(false),
    trackClicks: boolean("track_clicks").notNull().default(false),
    stopOnReply: boolean("stop_on_reply").notNull().default(true),
    reviewMode: text("review_mode", { enum: ["all", "first_step", "none"] })
      .notNull()
      .default("all"),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sequence_org_idx").on(t.organizationId)],
);

export const sequenceStep = pgTable(
  "sequence_step",
  {
    id: id(),
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type", { enum: ["auto_email", "manual_email", "call", "task"] }).notNull(),
    waitDays: integer("wait_days").notNull().default(0),
    subject: text("subject"),
    body: text("body"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("step_sequence_idx").on(t.sequenceId)],
);

export const enrollment = pgTable(
  "enrollment",
  {
    id: id(),
    organizationId: orgId(),
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => sequence.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "paused", "finished", "replied", "bounced", "unsubscribed", "removed"] })
      .notNull()
      .default("active"),
    currentStep: integer("current_step").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    enrolledById: text("enrolled_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("enrollment_seq_contact_idx").on(t.sequenceId, t.contactId)],
);

/* -------------------------------------------------------------------------- */
/* Pipeline: tasks and deals                                                  */
/* -------------------------------------------------------------------------- */

export const task = pgTable(
  "task",
  {
    id: id(),
    organizationId: orgId(),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "set null" }),
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    type: text("type", { enum: ["call", "email", "linkedin", "action_item"] })
      .notNull()
      .default("action_item"),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    status: text("status", { enum: ["open", "completed", "skipped"] })
      .notNull()
      .default("open"),
    title: text("title").notNull(),
    note: text("note"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("task_org_idx").on(t.organizationId), index("task_assignee_idx").on(t.assigneeId)],
);

export const DEAL_STAGES = ["qualify", "meeting", "proposal", "negotiation", "won", "lost"] as const;

export const deal = pgTable(
  "deal",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    stage: text("stage", { enum: DEAL_STAGES }).notNull().default("qualify"),
    amount: integer("amount"),
    currency: text("currency").notNull().default("USD"),
    closeDate: timestamp("close_date", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deal_org_idx").on(t.organizationId)],
);

/* -------------------------------------------------------------------------- */
/* Crawler: public-web research jobs                                          */
/* -------------------------------------------------------------------------- */

export const crawlJob = pgTable(
  "crawl_job",
  {
    id: id(),
    organizationId: orgId(),
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    seedUrl: text("seed_url").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] })
      .notNull()
      .default("queued"),
    maxPages: integer("max_pages").notNull().default(10),
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdById: text("created_by_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("crawl_job_org_idx").on(t.organizationId)],
);

export const crawlPage = pgTable(
  "crawl_page",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .references(() => crawlJob.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    statusCode: integer("status_code"),
    title: text("title"),
    skippedReason: text("skipped_reason"),
    fetchedAt: createdAt(),
  },
  (t) => [index("crawl_page_job_idx").on(t.jobId)],
);
