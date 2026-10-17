CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"activity_date" date,
	"professional_family" text NOT NULL,
	"project_id" uuid,
	"responsible_user_id" uuid NOT NULL,
	"created_by" uuid,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'pendiente_responsable' NOT NULL,
	"information_status" text DEFAULT 'en_revision' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_indicator_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"action_code" text NOT NULL,
	"indicator_code" text NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"participation_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" text,
	"source_label" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"scan_status" text DEFAULT 'no_configurado' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'evidencia' NOT NULL,
	"professional_family" text,
	"access_scope" text DEFAULT 'family' NOT NULL,
	"status" text DEFAULT 'pendiente_revision' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"activity_id" uuid,
	"plan_id" uuid,
	"indicator_code" text,
	"linked_by" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"captured_by" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pendiente_validacion' NOT NULL,
	CONSTRAINT "evidences_document_version_id_unique" UNIQUE("document_version_id")
);
--> statement-breakpoint
CREATE TABLE "indicator_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"indicator_code" text NOT NULL,
	"period" text NOT NULL,
	"revision" integer NOT NULL,
	"value" jsonb NOT NULL,
	"numerator" numeric,
	"denominator" numeric,
	"method" text NOT NULL,
	"formula" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"source_activity_count" integer DEFAULT 0 NOT NULL,
	"assessment" text NOT NULL,
	"created_by" uuid,
	"validated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_fields" jsonb NOT NULL,
	"reason" text NOT NULL,
	"request_key" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"responder_id" uuid,
	"response_status" text NOT NULL,
	"answers" jsonb NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "professional_family" text;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_pic_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."pic_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_indicator_links" ADD CONSTRAINT "activity_indicator_links_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_indicator_links" ADD CONSTRAINT "activity_indicator_links_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_indicator_links" ADD CONSTRAINT "activity_indicator_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_people" ADD CONSTRAINT "activity_people_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_people" ADD CONSTRAINT "activity_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sources" ADD CONSTRAINT "activity_sources_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sources" ADD CONSTRAINT "activity_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_versions" ADD CONSTRAINT "activity_versions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_versions" ADD CONSTRAINT "activity_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_observations" ADD CONSTRAINT "indicator_observations_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_observations" ADD CONSTRAINT "indicator_observations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_observations" ADD CONSTRAINT "indicator_observations_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_responses" ADD CONSTRAINT "information_responses_request_id_information_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."information_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_responses" ADD CONSTRAINT "information_responses_responder_id_users_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_responses" ADD CONSTRAINT "information_responses_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_center_year_fingerprint_uq" ON "activities" USING btree ("center_id","school_year_id","fingerprint");--> statement-breakpoint
CREATE INDEX "activities_center_year_status_idx" ON "activities" USING btree ("center_id","school_year_id","status");--> statement-breakpoint
CREATE INDEX "activities_family_date_idx" ON "activities" USING btree ("center_id","professional_family","activity_date");--> statement-breakpoint
CREATE INDEX "activities_responsible_idx" ON "activities" USING btree ("responsible_user_id","status");--> statement-breakpoint
CREATE INDEX "activities_revision_positive_idx" ON "activities" USING btree ("revision");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_indicator_links_activity_plan_code_uq" ON "activity_indicator_links" USING btree ("activity_id","plan_id","indicator_code");--> statement-breakpoint
CREATE INDEX "activity_indicator_links_plan_code_idx" ON "activity_indicator_links" USING btree ("plan_id","indicator_code");--> statement-breakpoint
CREATE INDEX "activity_people_activity_idx" ON "activity_people" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_people_user_idx" ON "activity_people" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_sources_activity_fingerprint_uq" ON "activity_sources" USING btree ("activity_id","source_fingerprint");--> statement-breakpoint
CREATE INDEX "activity_sources_activity_idx" ON "activity_sources" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_versions_activity_revision_uq" ON "activity_versions" USING btree ("activity_id","revision");--> statement-breakpoint
CREATE INDEX "activity_versions_created_idx" ON "activity_versions" USING btree ("activity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_version_uq" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_hash_uq" ON "document_versions" USING btree ("document_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_storage_key_uq" ON "document_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_versions_hash_idx" ON "document_versions" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "documents_center_year_status_idx" ON "documents" USING btree ("center_id","school_year_id","status");--> statement-breakpoint
CREATE INDEX "documents_family_idx" ON "documents" USING btree ("center_id","professional_family");--> statement-breakpoint
CREATE INDEX "documents_creator_idx" ON "documents" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "evidence_links_activity_idx" ON "evidence_links" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "evidence_links_indicator_idx" ON "evidence_links" USING btree ("plan_id","indicator_code");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_unique_scope_uq" ON "evidence_links" USING btree ("evidence_id","activity_id","plan_id","indicator_code") WHERE "evidence_links"."activity_id" IS NOT NULL OR "evidence_links"."plan_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "evidences_status_idx" ON "evidences" USING btree ("status","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_observations_plan_code_period_revision_uq" ON "indicator_observations" USING btree ("plan_id","indicator_code","period","revision");--> statement-breakpoint
CREATE INDEX "indicator_observations_latest_idx" ON "indicator_observations" USING btree ("plan_id","indicator_code","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "information_requests_open_dedupe_uq" ON "information_requests" USING btree ("center_id","school_year_id","request_key") WHERE "information_requests"."status" = 'solicitada';--> statement-breakpoint
CREATE INDEX "information_requests_recipient_status_idx" ON "information_requests" USING btree ("recipient_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "information_requests_subject_idx" ON "information_requests" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "information_responses_request_idx" ON "information_responses" USING btree ("request_id","created_at");