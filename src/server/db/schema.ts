import { sql } from "drizzle-orm";
import {
  bigint,
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
    annualRevenue: bigint("annual_revenue", { mode: "number" }),
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
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    /** Values of workspace custom fields (custom_field.key → value). */
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
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
      // Labels (settings → contact stages): new = Cold, contacted = Approaching.
      enum: [
        "new",
        "contacted",
        "replied",
        "interested",
        "not_interested",
        "unresponsive",
        "do_not_contact",
        "bad_data",
        "changed_job",
      ],
    })
      .notNull()
      .default("new"),
    source: text("source").notNull().default("manual"),
    /** Lawful basis for contacting this person, e.g. "legitimate_interest" (GDPR) or "implied_consent" (CASL). */
    consentBasis: text("consent_basis"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    personaId: text("persona_id"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
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
    /** SMTP settings for sending. The password is encrypted (src/server/crypto/secrets.ts) and write-only. */
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpSecure: text("smtp_secure", { enum: ["ssl", "starttls", "none"] })
      .notNull()
      .default("starttls"),
    smtpUser: text("smtp_user"),
    smtpPasswordEnc: text("smtp_password_enc"),
    /** Sender identification required in every message (CAN-SPAM / CASL). */
    postalAddress: text("postal_address"),
    /** HTML-free signature appended to every send (required when the workspace policy says so). */
    signature: text("signature"),
    /** Ramp-up start for gradual sending increase. */
    warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }),
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
    description: text("description"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    starred: boolean("starred").notNull().default(false),
    scheduleId: text("schedule_id"),
    cc: text("cc"),
    bcc: text("bcc"),
    /** Max emails this sequence sends per rolling 24 hours (null = mailbox limits only). */
    maxPer24h: integer("max_per_24h"),
    /** Ruleset: triggers, contact/email triggers (docs/reference/apollo-ui.md §7). */
    ruleset: jsonb("ruleset").$type<Record<string, unknown>>().notNull().default({}),
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
    type: text("type", {
      enum: [
        "auto_email",
        "manual_email",
        "call",
        "task",
        "linkedin_connect",
        "linkedin_message",
        "linkedin_view",
        "linkedin_interact",
      ],
    }).notNull(),
    waitDays: integer("wait_days").notNull().default(0),
    /** Extra wait in minutes on top of waitDays (e.g. "send in 30 minutes"). */
    waitMinutes: integer("wait_minutes").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    threadMode: text("thread_mode", { enum: ["new_thread", "reply"] })
      .notNull()
      .default("new_thread"),
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

/** Every email the app sends or drafts for review, one row per message. */
export const outboundMessage = pgTable(
  "outbound_message",
  {
    id: id(),
    organizationId: orgId(),
    mailboxId: text("mailbox_id").references(() => mailbox.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contact.id, { onDelete: "set null" }),
    enrollmentId: text("enrollment_id").references(() => enrollment.id, { onDelete: "set null" }),
    stepId: text("step_id").references(() => sequenceStep.id, { onDelete: "set null" }),
    variantId: text("variant_id"),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["pending_review", "queued", "sent", "failed", "bounced", "blocked"] })
      .notNull()
      .default("queued"),
    /** Why a message was blocked: suppressed, invalid email, mailbox limit… */
    blockedReason: text("blocked_reason"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("outbound_org_idx").on(t.organizationId), index("outbound_mailbox_sent_idx").on(t.mailboxId, t.sentAt)],
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
    dealId: text("deal_id"),
    enrollmentId: text("enrollment_id"),
    type: text("type", {
      enum: [
        "call",
        "email",
        "linkedin",
        "action_item",
        "linkedin_connect",
        "linkedin_message",
        "linkedin_view",
        "linkedin_interact",
      ],
    })
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
    /** Configurable pipelines (pipeline / pipeline_stage). When set, stageId is authoritative. */
    pipelineId: text("pipeline_id"),
    stageId: text("stage_id"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
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

/* -------------------------------------------------------------------------- */
/* Apollo-parity additions (docs/reference/apollo-ui.md)                      */
/* -------------------------------------------------------------------------- */

/** Saved searches (people / companies), with starring, sharing and assignment. */
export const savedSearch = pgTable(
  "saved_search",
  {
    id: id(),
    organizationId: orgId(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    assignedToId: text("assigned_to_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    entityType: text("entity_type", { enum: ["contact", "company"] }).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    columns: text("columns").array(),
    sort: jsonb("sort").$type<{ field: string; ascending: boolean } | null>(),
    starred: boolean("starred").notNull().default(false),
    shared: boolean("shared").notNull().default(false),
    /** Notify the owner when new records match. */
    alertsEnabled: boolean("alerts_enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("saved_search_org_idx").on(t.organizationId)],
);

/** Saved views for other tables (tasks, emails, deals). */
export const savedView = pgTable(
  "saved_view",
  {
    id: id(),
    organizationId: orgId(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    scope: text("scope", { enum: ["tasks", "emails", "deals", "lists"] }).notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    starred: boolean("starred").notNull().default(false),
    shared: boolean("shared").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("saved_view_org_idx").on(t.organizationId, t.scope)],
);

export const note = pgTable(
  "note",
  {
    id: id(),
    organizationId: orgId(),
    entityType: text("entity_type", { enum: ["contact", "company", "deal"] }).notNull(),
    entityId: text("entity_id").notNull(),
    body: text("body").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("note_entity_idx").on(t.entityType, t.entityId)],
);

/** Timeline of everything that happened to a record (emails, stage changes, notes, tasks, calls…). */
export const activity = pgTable(
  "activity",
  {
    id: id(),
    organizationId: orgId(),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    dealId: text("deal_id"),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    actorUserId: text("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_contact_idx").on(t.contactId, t.occurredAt),
    index("activity_company_idx").on(t.companyId, t.occurredAt),
    index("activity_org_idx").on(t.organizationId, t.occurredAt),
  ],
);

export const customField = pgTable(
  "custom_field",
  {
    id: id(),
    organizationId: orgId(),
    entityType: text("entity_type", { enum: ["contact", "company", "deal"] }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: ["text", "number", "date", "boolean", "picklist", "url"] }).notNull(),
    options: text("options").array(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_field_org_key_idx").on(t.organizationId, t.entityType, t.key)],
);

export const persona = pgTable(
  "persona",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    titles: text("titles").array().notNull().default(sql`'{}'::text[]`),
    seniorities: text("seniorities").array().notNull().default(sql`'{}'::text[]`),
    departments: text("departments").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [index("persona_org_idx").on(t.organizationId)],
);

/** Stage display names and protection per workspace (contact / account stages). */
export const recordStage = pgTable(
  "record_stage",
  {
    id: id(),
    organizationId: orgId(),
    entityType: text("entity_type", { enum: ["contact", "company"] }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
    /** Don't override with event triggers when set manually. */
    protected: boolean("protected").notNull().default(false),
  },
  (t) => [uniqueIndex("record_stage_org_key_idx").on(t.organizationId, t.entityType, t.key)],
);

/** Event → contact stage rules (settings → contact stages → triggers). */
export const stageTrigger = pgTable(
  "stage_trigger",
  {
    id: id(),
    organizationId: orgId(),
    event: text("event", {
      enum: [
        "prospect_created",
        "email_delivered",
        "email_bounced",
        "spam_blocked",
        "unsubscribed",
        "replied",
        "interested",
        "unresponsive",
      ],
    }).notNull(),
    stageKey: text("stage_key"),
  },
  (t) => [uniqueIndex("stage_trigger_org_event_idx").on(t.organizationId, t.event)],
);

export const pipeline = pgTable(
  "pipeline",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("pipeline_org_idx").on(t.organizationId)],
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: id(),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipeline.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    type: text("type", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    probability: integer("probability"),
  },
  (t) => [index("pipeline_stage_pipeline_idx").on(t.pipelineId)],
);

/** Reusable sending schedules: time zone + weekly windows. */
export const sendingSchedule = pgTable(
  "sending_schedule",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    /** { mon: [["08:00","17:00"]], tue: [...], ... } */
    windows: jsonb("windows").$type<Record<string, [string, string][]>>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_org_idx").on(t.organizationId)],
);

/** A/B variants of an email step. Steps without variants use sequence_step.subject/body. */
export const stepVariant = pgTable(
  "step_variant",
  {
    id: id(),
    stepId: text("step_id")
      .notNull()
      .references(() => sequenceStep.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    subject: text("subject"),
    body: text("body"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("variant_step_idx").on(t.stepId)],
);

export const emailTemplate = pgTable(
  "email_template",
  {
    id: id(),
    organizationId: orgId(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    shared: boolean("shared").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("template_org_idx").on(t.organizationId)],
);

export const snippet = pgTable(
  "snippet",
  {
    id: id(),
    organizationId: orgId(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    shared: boolean("shared").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("snippet_org_idx").on(t.organizationId)],
);

export const workflow = pgTable(
  "workflow",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "active", "paused", "archived"] })
      .notNull()
      .default("draft"),
    targetType: text("target_type", { enum: ["contact", "company", "deal"] })
      .notNull()
      .default("contact"),
    triggerType: text("trigger_type", { enum: ["event", "schedule"] })
      .notNull()
      .default("event"),
    triggerEvent: text("trigger_event"),
    /** For schedule triggers: { at?: ISO date, weekly?: { days: string[], time: "HH:MM" }, timezone } */
    schedule: jsonb("schedule").$type<Record<string, unknown>>(),
    enrollmentFilters: jsonb("enrollment_filters").$type<Record<string, unknown>>().notNull().default({}),
    /** Ordered block tree: rules (branch, split, delay, exit) and actions. */
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default([]),
    createdById: text("created_by_id"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workflow_org_idx").on(t.organizationId)],
);

export const workflowRun = pgTable(
  "workflow_run",
  {
    id: id(),
    organizationId: orgId(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    status: text("status", { enum: ["running", "waiting", "completed", "failed", "exited"] })
      .notNull()
      .default("running"),
    /** Position in the block tree, and when a delay ends. */
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    resumeAt: timestamp("resume_at", { withTimezone: true }),
    log: jsonb("log").$type<unknown[]>().notNull().default([]),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("workflow_run_wf_idx").on(t.workflowId), index("workflow_run_resume_idx").on(t.status, t.resumeAt)],
);

export const notification = pgTable(
  "notification",
  {
    id: id(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

/** Per user and workspace: onboarding answers, checklist progress, consents. */
export const onboardingState = pgTable(
  "onboarding_state",
  {
    id: id(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role"),
    teamSize: text("team_size"),
    goals: text("goals").array().notNull().default(sql`'{}'::text[]`),
    completedSteps: text("completed_steps").array().notNull().default(sql`'{}'::text[]`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    hubDismissedAt: timestamp("hub_dismissed_at", { withTimezone: true }),
    /** Anti-spam acknowledgement (before connecting a mailbox / creating the first sequence). */
    antiSpamAcceptedAt: timestamp("anti_spam_accepted_at", { withTimezone: true }),
    homeLayout: text("home_layout").notNull().default("getting_started"),
  },
  (t) => [uniqueIndex("onboarding_org_user_idx").on(t.organizationId, t.userId)],
);

/** Sending protection policies per workspace (settings → email setup and health). */
export const sendingPolicy = pgTable("sending_policy", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  autoPauseOnAuthIssue: boolean("auto_pause_on_auth_issue").notNull().default(false),
  restrictUnverified: boolean("restrict_unverified").notNull().default(false),
  restrictCatchAll: boolean("restrict_catch_all").notNull().default(true),
  requireSignature: boolean("require_signature").notNull().default(false),
  gradualRamp: boolean("gradual_ramp").notNull().default(false),
  bounceGuard: boolean("bounce_guard").notNull().default(true),
  /** Fraction (0.05 = 5%) of bounces over the last 100 sends that pauses a sequence. */
  bounceThreshold: real("bounce_threshold").notNull().default(0.05),
  workspaceDailyLimit: integer("workspace_daily_limit"),
  updatedAt: updatedAt(),
});

/** DNS health of a sending domain (SPF, DKIM, DMARC, MX, tracking CNAME). */
export const sendingDomain = pgTable(
  "sending_domain",
  {
    id: id(),
    organizationId: orgId(),
    domain: text("domain").notNull(),
    spf: text("spf", { enum: ["pass", "fail", "missing", "unknown"] })
      .notNull()
      .default("unknown"),
    dkim: text("dkim", { enum: ["pass", "fail", "missing", "unknown"] })
      .notNull()
      .default("unknown"),
    dmarc: text("dmarc", { enum: ["pass", "fail", "missing", "unknown"] })
      .notNull()
      .default("unknown"),
    mx: text("mx", { enum: ["pass", "fail", "missing", "unknown"] })
      .notNull()
      .default("unknown"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sending_domain_org_idx").on(t.organizationId, t.domain)],
);

/** Bulk enrichment jobs (CSV upload, list, selected records). */
export const enrichmentJob = pgTable(
  "enrichment_job",
  {
    id: id(),
    organizationId: orgId(),
    kind: text("kind", { enum: ["csv", "list", "records"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] })
      .notNull()
      .default("queued"),
    fileName: text("file_name"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    enriched: integer("enriched").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    options: jsonb("options").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("enrichment_job_org_idx").on(t.organizationId)],
);

/** Analytics dashboards (system or custom) made of widgets. */
export const dashboard = pgTable(
  "dashboard",
  {
    id: id(),
    organizationId: orgId(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["system", "custom", "home"] })
      .notNull()
      .default("custom"),
    widgets: jsonb("widgets").$type<unknown[]>().notNull().default([]),
    starred: boolean("starred").notNull().default(false),
    shared: boolean("shared").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("dashboard_org_idx").on(t.organizationId)],
);

/** AI context center: what the workspace sells and to whom (grounds AI drafts). */
export const aiContext = pgTable("ai_context", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  companyDescription: text("company_description"),
  valueProposition: text("value_proposition"),
  targetCustomers: text("target_customers"),
  tone: text("tone"),
  updatedAt: updatedAt(),
});

export const aiChat = pgTable(
  "ai_chat",
  {
    id: id(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_chat_user_idx").on(t.organizationId, t.userId)],
);

export const aiMessage = pgTable(
  "ai_message",
  {
    id: id(),
    chatId: text("chat_id")
      .notNull()
      .references(() => aiChat.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_message_chat_idx").on(t.chatId, t.createdAt)],
);

/**
 * A workspace's own key for an outside data provider (bring your own data). Used to fill gaps the
 * discovery index and crawler can't; the workspace holds the licence with the provider.
 */
export const dataProvider = pgTable(
  "data_provider",
  {
    id: id(),
    organizationId: orgId(),
    provider: text("provider", { enum: ["people_data_labs", "apollo", "hunter"] }).notNull(),
    /** AES-256-GCM (src/server/crypto/secrets.ts); never returned after it is saved. */
    apiKeyEnc: text("api_key_enc").notNull(),
    keyHint: text("key_hint"),
    enabled: boolean("enabled").notNull().default(true),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("data_provider_org_provider_idx").on(t.organizationId, t.provider)],
);

/* -------------------------------------------------------------------------- */
/* Installation-wide discovery index (self-hosted data pipeline)              */
/* Built only from public sources; never from workspaces' private records.    */
/* -------------------------------------------------------------------------- */

export const indexCompany = pgTable(
  "index_company",
  {
    id: id(),
    domain: text("domain").notNull().unique(),
    name: text("name"),
    websiteUrl: text("website_url"),
    description: text("description"),
    industry: text("industry"),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    technologies: text("technologies").array().notNull().default(sql`'{}'::text[]`),
    employeeCount: integer("employee_count"),
    employeeRange: text("employee_range"),
    foundedYear: integer("founded_year"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    twitterUrl: text("twitter_url"),
    emailPattern: text("email_pattern"),
    /** UK Companies House company number (official registry). */
    companiesHouseNumber: text("companies_house_number").unique(),
    /** US SEC EDGAR central index key, without leading zeros. */
    secCik: text("sec_cik").unique(),
    /** [{ source, url, retrievedAt, fields: string[] }] */
    sources: jsonb("sources").$type<unknown[]>().notNull().default([]),
    firstSeenAt: createdAt(),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    optedOut: boolean("opted_out").notNull().default(false),
  },
  (t) => [index("index_company_country_idx").on(t.country), index("index_company_industry_idx").on(t.industry)],
);

export const indexPerson = pgTable(
  "index_person",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => indexCompany.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    seniority: text("seniority"),
    department: text("department"),
    /** Only an address the company published itself; otherwise found on demand. */
    publishedEmail: text("published_email"),
    /** A LinkedIn profile URL the company or a registry published next to the person; never fetched. */
    linkedinUrl: text("linkedin_url"),
    /** Where the person was found: the company's own pages or an official registry. */
    source: text("source", { enum: ["crawl", "companies_house", "sec_edgar"] })
      .notNull()
      .default("crawl"),
    sourceUrl: text("source_url").notNull(),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** No longer listed on the source page (possible job change). */
    goneAt: timestamp("gone_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("index_person_company_name_idx").on(t.companyId, t.fullName),
    index("index_person_title_idx").on(t.title),
  ],
);

export const indexJobPosting = pgTable(
  "index_job_posting",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => indexCompany.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    department: text("department"),
    location: text("location"),
    url: text("url").notNull(),
    source: text("source").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("index_job_url_idx").on(t.url), index("index_job_company_idx").on(t.companyId)],
);

export const indexNews = pgTable(
  "index_news",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => indexCompany.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    source: text("source").notNull(),
    firstSeenAt: createdAt(),
  },
  (t) => [uniqueIndex("index_news_url_idx").on(t.url), index("index_news_company_idx").on(t.companyId)],
);

/** Per-host politeness state and robots.txt cache. */
export const crawlHost = pgTable("crawl_host", {
  host: text("host").primaryKey(),
  robotsTxt: text("robots_txt"),
  robotsFetchedAt: timestamp("robots_fetched_at", { withTimezone: true }),
  crawlDelayMs: integer("crawl_delay_ms").notNull().default(2000),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }),
  errorCount: integer("error_count").notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  blockedReason: text("blocked_reason"),
});

/** URL frontier for the crawler fleet. */
export const crawlFrontier = pgTable(
  "crawl_frontier",
  {
    id: id(),
    url: text("url").notNull().unique(),
    host: text("host").notNull(),
    kind: text("kind", {
      enum: ["homepage", "about", "team", "contact", "careers", "sitemap", "rss", "ats", "other"],
    })
      .notNull()
      .default("other"),
    priority: integer("priority").notNull().default(50),
    depth: integer("depth").notNull().default(0),
    status: text("status", { enum: ["queued", "fetching", "done", "failed", "skipped"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer("last_status_code"),
    skippedReason: text("skipped_reason"),
    discoveredFrom: text("discovered_from"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("frontier_due_idx").on(t.status, t.nextAttemptAt, t.priority), index("frontier_host_idx").on(t.host)],
);

/** Where seeds come from (Wikidata, domain lists, sitemaps, manual). */
export const seedSource = pgTable("seed_source", {
  id: id(),
  kind: text("kind", {
    enum: ["wikidata", "domain_list", "sitemap", "manual", "ats_boards", "companies_house", "sec_edgar"],
  }).notNull(),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(false),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  stats: jsonb("stats").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

/** Opt-outs and removal requests honoured by the index and every workspace. */
export const indexOptout = pgTable(
  "index_optout",
  {
    id: id(),
    kind: text("kind", { enum: ["domain", "email", "person"] }).notNull(),
    /** domain, email address, or "full name|domain" for a person. */
    value: text("value").notNull(),
    reason: text("reason"),
    requestedBy: text("requested_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("index_optout_value_idx").on(t.kind, t.value)],
);
