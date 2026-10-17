CREATE TABLE "pic_followup_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"external_identifier" text,
	"proof_document_id" uuid NOT NULL,
	"confirmation" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_followup_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"content" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pic_followup_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"report_revision" integer NOT NULL,
	"reason" text NOT NULL,
	"source_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_report_id_pic_followup_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pic_followup_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_snapshot_id_pic_followup_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."pic_followup_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_proof_document_id_documents_id_fk" FOREIGN KEY ("proof_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_reports" ADD CONSTRAINT "pic_followup_reports_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_reports" ADD CONSTRAINT "pic_followup_reports_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_reports" ADD CONSTRAINT "pic_followup_reports_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_reports" ADD CONSTRAINT "pic_followup_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_snapshots" ADD CONSTRAINT "pic_followup_snapshots_report_id_pic_followup_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pic_followup_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_snapshots" ADD CONSTRAINT "pic_followup_snapshots_center_id_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_snapshots" ADD CONSTRAINT "pic_followup_snapshots_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_snapshots" ADD CONSTRAINT "pic_followup_snapshots_plan_id_pic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pic_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pic_followup_snapshots" ADD CONSTRAINT "pic_followup_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pic_followup_deliveries_report_idx" ON "pic_followup_deliveries" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_followup_deliveries_snapshot_uq" ON "pic_followup_deliveries" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_followup_reports_plan_type_uq" ON "pic_followup_reports" USING btree ("plan_id","report_type");--> statement-breakpoint
CREATE INDEX "pic_followup_reports_year_type_idx" ON "pic_followup_reports" USING btree ("school_year_id","report_type");--> statement-breakpoint
CREATE UNIQUE INDEX "pic_followup_snapshots_report_version_uq" ON "pic_followup_snapshots" USING btree ("report_id","version");--> statement-breakpoint
CREATE INDEX "pic_followup_snapshots_year_type_idx" ON "pic_followup_snapshots" USING btree ("school_year_id","created_at");
--> statement-breakpoint
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'pic_followup_reports','pic_followup_snapshots','pic_followup_deliveries'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS course_write_guard ON %I', tab);
    EXECUTE format(
      'CREATE TRIGGER course_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_course_write()',
      tab
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_pic_followup_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'PIC_FOLLOWUP_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pic_followup_reports r
    WHERE r.id=NEW.report_id AND r.plan_id=NEW.plan_id
      AND r.school_year_id=NEW.school_year_id AND r.center_id=NEW.center_id
  ) THEN
    RAISE EXCEPTION 'PIC_FOLLOWUP_SCOPE_CONFLICT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pic_followup_snapshot_immutable ON pic_followup_snapshots;
CREATE TRIGGER pic_followup_snapshot_immutable BEFORE INSERT OR UPDATE OR DELETE ON pic_followup_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_pic_followup_snapshot();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_pic_followup_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'PIC_FOLLOWUP_DELIVERY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pic_followup_reports r
    JOIN pic_followup_snapshots s ON s.report_id=r.id
    WHERE r.id=NEW.report_id AND s.id=NEW.snapshot_id
      AND r.plan_id=NEW.plan_id AND s.plan_id=NEW.plan_id
      AND r.school_year_id=NEW.school_year_id AND s.school_year_id=NEW.school_year_id
      AND r.center_id=NEW.center_id AND s.center_id=NEW.center_id
  ) THEN
    RAISE EXCEPTION 'PIC_FOLLOWUP_SCOPE_CONFLICT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pic_followup_delivery_immutable ON pic_followup_deliveries;
CREATE TRIGGER pic_followup_delivery_immutable BEFORE INSERT OR UPDATE OR DELETE ON pic_followup_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_pic_followup_delivery();