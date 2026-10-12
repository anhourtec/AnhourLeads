CREATE TABLE "data_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"key_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"last_used_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "index_company" ADD COLUMN "companies_house_number" text;--> statement-breakpoint
ALTER TABLE "index_company" ADD COLUMN "sec_cik" text;--> statement-breakpoint
ALTER TABLE "index_person" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "index_person" ADD COLUMN "source" text DEFAULT 'crawl' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_provider" ADD CONSTRAINT "data_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_provider" ADD CONSTRAINT "data_provider_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_provider_org_provider_idx" ON "data_provider" USING btree ("organization_id","provider");--> statement-breakpoint
ALTER TABLE "index_company" ADD CONSTRAINT "index_company_companies_house_number_unique" UNIQUE("companies_house_number");--> statement-breakpoint
ALTER TABLE "index_company" ADD CONSTRAINT "index_company_sec_cik_unique" UNIQUE("sec_cik");