CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"company_id" text,
	"deal_id" text,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"actor_user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_context" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"company_description" text,
	"value_proposition" text,
	"target_customers" text,
	"tone" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" text[],
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrichment_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"file_name" text,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"enriched" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"options" jsonb,
	"result" jsonb,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text,
	"team_size" text,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"completed_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"finished_at" timestamp with time zone,
	"hub_dismissed_at" timestamp with time zone,
	"anti_spam_accepted_at" timestamp with time zone,
	"home_layout" text DEFAULT 'getting_started' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"seniorities" text[] DEFAULT '{}'::text[] NOT NULL,
	"departments" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"type" text DEFAULT 'open' NOT NULL,
	"probability" integer
);
--> statement-breakpoint
CREATE TABLE "record_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"protected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_search" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"assigned_to_id" text,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" text[],
	"sort" jsonb,
	"starred" boolean DEFAULT false NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"alerts_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"spf" text DEFAULT 'unknown' NOT NULL,
	"dkim" text DEFAULT 'unknown' NOT NULL,
	"dmarc" text DEFAULT 'unknown' NOT NULL,
	"mx" text DEFAULT 'unknown' NOT NULL,
	"details" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_policy" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"auto_pause_on_auth_issue" boolean DEFAULT false NOT NULL,
	"restrict_unverified" boolean DEFAULT false NOT NULL,
	"restrict_catch_all" boolean DEFAULT true NOT NULL,
	"require_signature" boolean DEFAULT false NOT NULL,
	"gradual_ramp" boolean DEFAULT false NOT NULL,
	"bounce_guard" boolean DEFAULT true NOT NULL,
	"bounce_threshold" real DEFAULT 0.05 NOT NULL,
	"workspace_daily_limit" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"windows" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippet" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event" text NOT NULL,
	"stage_key" text
);
--> statement-breakpoint
CREATE TABLE "step_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"step_id" text NOT NULL,
	"label" text NOT NULL,
	"subject" text,
	"body" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_type" text DEFAULT 'contact' NOT NULL,
	"trigger_type" text DEFAULT 'event' NOT NULL,
	"trigger_event" text,
	"schedule" jsonb,
	"enrollment_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cursor" jsonb,
	"resume_at" timestamp with time zone,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "persona_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "stage_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "warmup_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD COLUMN "variant_id" text;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "starred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "cc" text;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "bcc" text;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "max_per_24h" integer;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "ruleset" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sequence_step" ADD COLUMN "wait_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sequence_step" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sequence_step" ADD COLUMN "thread_mode" text DEFAULT 'new_thread' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "deal_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "enrollment_id" text;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat" ADD CONSTRAINT "ai_chat_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat" ADD CONSTRAINT "ai_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_context" ADD CONSTRAINT "ai_context_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_chat_id_ai_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_job" ADD CONSTRAINT "enrichment_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona" ADD CONSTRAINT "persona_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_stage" ADD CONSTRAINT "record_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domain" ADD CONSTRAINT "sending_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_policy" ADD CONSTRAINT "sending_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_schedule" ADD CONSTRAINT "sending_schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet" ADD CONSTRAINT "snippet_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippet" ADD CONSTRAINT "snippet_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_trigger" ADD CONSTRAINT "stage_trigger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_variant" ADD CONSTRAINT "step_variant_step_id_sequence_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_contact_idx" ON "activity" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_company_idx" ON "activity" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_org_idx" ON "activity" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ai_chat_user_idx" ON "ai_chat" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_message_chat_idx" ON "ai_message" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_org_key_idx" ON "custom_field" USING btree ("organization_id","entity_type","key");--> statement-breakpoint
CREATE INDEX "dashboard_org_idx" ON "dashboard" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_org_idx" ON "email_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "enrichment_job_org_idx" ON "enrichment_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "note_entity_idx" ON "note" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_org_user_idx" ON "onboarding_state" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "persona_org_idx" ON "persona" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pipeline_org_idx" ON "pipeline" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pipeline_stage_pipeline_idx" ON "pipeline_stage" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_stage_org_key_idx" ON "record_stage" USING btree ("organization_id","entity_type","key");--> statement-breakpoint
CREATE INDEX "saved_search_org_idx" ON "saved_search" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "saved_view_org_idx" ON "saved_view" USING btree ("organization_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domain_org_idx" ON "sending_domain" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "schedule_org_idx" ON "sending_schedule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "snippet_org_idx" ON "snippet" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_trigger_org_event_idx" ON "stage_trigger" USING btree ("organization_id","event");--> statement-breakpoint
CREATE INDEX "variant_step_idx" ON "step_variant" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "workflow_org_idx" ON "workflow" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflow_run_wf_idx" ON "workflow_run" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_run_resume_idx" ON "workflow_run" USING btree ("status","resume_at");--> statement-breakpoint
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;