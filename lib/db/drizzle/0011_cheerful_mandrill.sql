ALTER TABLE "pic_followup_deliveries" ADD COLUMN "proof_version_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD COLUMN "proof_file_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD COLUMN "proof_sha256" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pic_followup_deliveries" ADD CONSTRAINT "pic_followup_deliveries_proof_version_id_document_versions_id_fk" FOREIGN KEY ("proof_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_pic_followup_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'PIC_FOLLOWUP_DELIVERY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pic_followup_reports r
    JOIN pic_followup_snapshots s ON s.report_id=r.id
    JOIN documents d ON d.id=NEW.proof_document_id
    JOIN document_versions v ON v.id=NEW.proof_version_id AND v.document_id=d.id
    WHERE r.id=NEW.report_id AND s.id=NEW.snapshot_id
      AND r.plan_id=NEW.plan_id AND s.plan_id=NEW.plan_id
      AND r.school_year_id=NEW.school_year_id AND s.school_year_id=NEW.school_year_id
      AND r.center_id=NEW.center_id AND s.center_id=NEW.center_id
      AND d.center_id=NEW.center_id AND d.school_year_id=NEW.school_year_id
      AND d.status='aprobado' AND d.access_scope='center' AND d.archived_at IS NULL
      AND v.scan_status='limpio'
      AND v.original_name=NEW.proof_file_name AND v.sha256=NEW.proof_sha256
  ) THEN
    RAISE EXCEPTION 'PIC_FOLLOWUP_SCOPE_CONFLICT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;