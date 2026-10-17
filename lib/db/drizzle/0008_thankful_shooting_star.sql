CREATE TABLE "ciclope_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'programada' NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ciclope_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_year_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ciclope_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_year_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"require_institutional_approval" boolean DEFAULT true NOT NULL,
	"authorized_internal_channel" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ciclope_policies_school_year_id_unique" UNIQUE("school_year_id")
);
--> statement-breakpoint
CREATE TABLE "ciclope_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_year_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"responsible_user_id" uuid NOT NULL,
	"due_date" text NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ciclope_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_year_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ciclope_meetings" ADD CONSTRAINT "ciclope_meetings_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_meetings" ADD CONSTRAINT "ciclope_meetings_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_meetings" ADD CONSTRAINT "ciclope_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_notices" ADD CONSTRAINT "ciclope_notices_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_notices" ADD CONSTRAINT "ciclope_notices_meeting_id_ciclope_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."ciclope_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_notices" ADD CONSTRAINT "ciclope_notices_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_policies" ADD CONSTRAINT "ciclope_policies_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_policies" ADD CONSTRAINT "ciclope_policies_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_tasks" ADD CONSTRAINT "ciclope_tasks_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_tasks" ADD CONSTRAINT "ciclope_tasks_meeting_id_ciclope_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."ciclope_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_tasks" ADD CONSTRAINT "ciclope_tasks_source_version_id_ciclope_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."ciclope_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_tasks" ADD CONSTRAINT "ciclope_tasks_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_versions" ADD CONSTRAINT "ciclope_versions_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_versions" ADD CONSTRAINT "ciclope_versions_meeting_id_ciclope_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."ciclope_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclope_versions" ADD CONSTRAINT "ciclope_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ciclope_version_revision_uq" ON "ciclope_versions" USING btree ("meeting_id","revision");