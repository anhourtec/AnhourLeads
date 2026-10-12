CREATE TABLE "outbound_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mailbox_id" text,
	"contact_id" text,
	"enrollment_id" text,
	"step_id" text,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"blocked_reason" text,
	"provider_message_id" text,
	"error" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "annual_revenue" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "smtp_secure" text DEFAULT 'starttls' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "smtp_password_enc" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_step_id_sequence_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_org_idx" ON "outbound_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "outbound_mailbox_sent_idx" ON "outbound_message" USING btree ("mailbox_id","sent_at");