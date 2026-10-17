CREATE TABLE "pic_action_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"action_code" text NOT NULL,
	"objective_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_calendar_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"meeting_type" text NOT NULL,
	"position" integer NOT NULL,
	"scheduled_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_ciclope_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"professional_family" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_custom_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"objective_code" text NOT NULL,
	"title" text NOT NULL,
	"indicator_label" text NOT NULL,
	"unit" text NOT NULL,
	"target_value" jsonb NOT NULL,
	"risk_value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_dafo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"quadrant" text NOT NULL,
	"position" integer NOT NULL,
	"category" text NOT NULL,
	"situation" text NOT NULL,
	"custom_detail" text
);
--> statement-breakpoint
CREATE TABLE "pic_indicator_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"action_code" text NOT NULL,
	"indicator_id" text NOT NULL,
	"unit" text NOT NULL,
	"target_value" jsonb NOT NULL,
	"risk_value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_ods_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"agenda" text NOT NULL,
	"ods_code" text NOT NULL,
	"objective_codes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"catalog_row_id" uuid NOT NULL,
	"catalog_version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"promoter" text NOT NULL,
	"name" text NOT NULL,
	"center_coordinates" boolean DEFAULT false NOT NULL,
	"coordinating_family" text NOT NULL,
	"coordinator_name" text NOT NULL,
	"coordinator_email" text NOT NULL,
	"included_in_pic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"plan_revision" integer NOT NULL,
	"reason" text NOT NULL,
	"source_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_submission_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"submission_date" date NOT NULL,
	"external_identifier" text,
	"evidence_file_name" text NOT NULL,
	"evidence_mime_type" text NOT NULL,
	"evidence_sha256" text NOT NULL,
	"evidence_storage_key" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pic_action_selections" ADD CONSTRAINT "pic_action_selections_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_calendar_meetings" ADD CONSTRAINT "pic_calendar_meetings_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_ciclope_members" ADD CONSTRAINT "pic_ciclope_members_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_custom_actions" ADD CONSTRAINT "pic_custom_actions_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_dafo" ADD CONSTRAINT "pic_dafo_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_indicator_targets" ADD CONSTRAINT "pic_indicator_targets_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_indicator_targets" ADD CONSTRAINT "pic_indicator_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_ods_links" ADD CONSTRAINT "pic_ods_links_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_plans" ADD CONSTRAINT "pic_plans_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_plans" ADD CONSTRAINT "pic_plans_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_plans" ADD CONSTRAINT "pic_plans_catalog_row_id_pic_catalogs_row_id_fk" FOREIGN KEY ("catalog_row_id") REFERENCES "public"."pic_catalogs"("row_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_plans" ADD CONSTRAINT "pic_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_projects" ADD CONSTRAINT "pic_projects_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_snapshots" ADD CONSTRAINT "pic_snapshots_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_snapshots" ADD CONSTRAINT "pic_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_submission_records" ADD CONSTRAINT "pic_submission_records_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_submission_records" ADD CONSTRAINT "pic_submission_records_snapshot_id_pic_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pic_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_submission_records" ADD CONSTRAINT "pic_submission_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pic_action_selections_plan_code_uq" ON "pic_action_selections" USING btree ("plan_id","action_code");--> statement-breakpoint
CREATE INDEX "pic_action_selections_objective_idx" ON "pic_action_selections" USING btree ("plan_id","objective_code");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_calendar_meetings_plan_type_position_uq" ON "pic_calendar_meetings" USING btree ("plan_id","meeting_type","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_ciclope_members_plan_position_uq" ON "pic_ciclope_members" USING btree ("plan_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_custom_actions_plan_position_uq" ON "pic_custom_actions" USING btree ("plan_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_dafo_plan_position_uq" ON "pic_dafo" USING btree ("plan_id","quadrant","position");--> statement-breakpoint
CREATE INDEX "pic_dafo_plan_quadrant_idx" ON "pic_dafo" USING btree ("plan_id","quadrant");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_indicator_targets_plan_id_uq" ON "pic_indicator_targets" USING btree ("plan_id","indicator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_ods_links_plan_agenda_code_uq" ON "pic_ods_links" USING btree ("plan_id","agenda","ods_code");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_plans_center_year_uq" ON "pic_plans" USING btree ("center_id","school_year_id");--> statement-breakpoint
CREATE INDEX "pic_plans_status_idx" ON "pic_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pic_projects_plan_idx" ON "pic_projects" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "pic_projects_selected_idx" ON "pic_projects" USING btree ("plan_id","included_in_pic");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_snapshots_plan_version_uq" ON "pic_snapshots" USING btree ("plan_id","version");--> statement-breakpoint
CREATE INDEX "pic_submission_records_plan_idx" ON "pic_submission_records" USING btree ("plan_id");