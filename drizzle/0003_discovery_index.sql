CREATE TABLE "crawl_frontier" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"host" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status_code" integer,
	"skipped_reason" text,
	"discovered_from" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_frontier_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "crawl_host" (
	"host" text PRIMARY KEY NOT NULL,
	"robots_txt" text,
	"robots_fetched_at" timestamp with time zone,
	"crawl_delay_ms" integer DEFAULT 2000 NOT NULL,
	"next_allowed_at" timestamp with time zone,
	"error_count" integer DEFAULT 0 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text
);
--> statement-breakpoint
CREATE TABLE "index_company" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"website_url" text,
	"description" text,
	"industry" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"technologies" text[] DEFAULT '{}'::text[] NOT NULL,
	"employee_count" integer,
	"employee_range" text,
	"founded_year" integer,
	"country" text,
	"region" text,
	"city" text,
	"phone" text,
	"linkedin_url" text,
	"twitter_url" text,
	"email_pattern" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"opted_out" boolean DEFAULT false NOT NULL,
	CONSTRAINT "index_company_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "index_job_posting" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"department" text,
	"location" text,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"posted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_news" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_optout" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_person" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"seniority" text,
	"department" text,
	"published_email" text,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seed_source" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "index_job_posting" ADD CONSTRAINT "index_job_posting_company_id_index_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."index_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_news" ADD CONSTRAINT "index_news_company_id_index_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."index_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_person" ADD CONSTRAINT "index_person_company_id_index_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."index_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frontier_due_idx" ON "crawl_frontier" USING btree ("status","next_attempt_at","priority");--> statement-breakpoint
CREATE INDEX "frontier_host_idx" ON "crawl_frontier" USING btree ("host");--> statement-breakpoint
CREATE INDEX "index_company_country_idx" ON "index_company" USING btree ("country");--> statement-breakpoint
CREATE INDEX "index_company_industry_idx" ON "index_company" USING btree ("industry");--> statement-breakpoint
CREATE UNIQUE INDEX "index_job_url_idx" ON "index_job_posting" USING btree ("url");--> statement-breakpoint
CREATE INDEX "index_job_company_idx" ON "index_job_posting" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_news_url_idx" ON "index_news" USING btree ("url");--> statement-breakpoint
CREATE INDEX "index_news_company_idx" ON "index_news" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_optout_value_idx" ON "index_optout" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "index_person_company_name_idx" ON "index_person" USING btree ("company_id","full_name");--> statement-breakpoint
CREATE INDEX "index_person_title_idx" ON "index_person" USING btree ("title");