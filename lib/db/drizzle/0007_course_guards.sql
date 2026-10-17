-- Closed courses are immutable. Every child write locks and revises its course,
-- so stale forms and writes racing the close cannot silently change the snapshot.
CREATE OR REPLACE FUNCTION course_row_year(tab text, row_data jsonb) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE result uuid;
BEGIN
  IF row_data ? 'school_year_id' THEN RETURN (row_data->>'school_year_id')::uuid; END IF;
  IF row_data ? 'plan_id' AND row_data->>'plan_id' IS NOT NULL THEN
    SELECT school_year_id INTO result FROM pic_plans WHERE id=(row_data->>'plan_id')::uuid;
  ELSIF row_data ? 'activity_id' AND row_data->>'activity_id' IS NOT NULL THEN
    SELECT school_year_id INTO result FROM activities WHERE id=(row_data->>'activity_id')::uuid;
  ELSIF row_data ? 'document_id' THEN
    SELECT school_year_id INTO result FROM documents WHERE id=(row_data->>'document_id')::uuid;
  ELSIF row_data ? 'document_version_id' THEN
    SELECT d.school_year_id INTO result FROM documents d JOIN document_versions v ON v.document_id=d.id
      WHERE v.id=(row_data->>'document_version_id')::uuid;
  ELSIF row_data ? 'evidence_id' AND row_data->>'evidence_id' IS NOT NULL THEN
    SELECT d.school_year_id INTO result
      FROM evidences e JOIN document_versions v ON v.id=e.document_version_id
      JOIN documents d ON d.id=v.document_id WHERE e.id=(row_data->>'evidence_id')::uuid;
  ELSIF row_data ? 'request_id' THEN
    SELECT school_year_id INTO result FROM information_requests WHERE id=(row_data->>'request_id')::uuid;
  END IF;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_course_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE data jsonb; year_id uuid; other_year uuid; field text; ref_table text; touched uuid;
BEGIN
  IF TG_OP='DELETE' THEN data=to_jsonb(OLD); ELSE data=to_jsonb(NEW); END IF;
  year_id=course_row_year(TG_TABLE_NAME,data);
  -- A permitted active parent deletion may already have removed its row when
  -- PostgreSQL runs cascading child deletes. Closed parents are vetoed first.
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND
      (year_id IS NULL OR NOT EXISTS (SELECT 1 FROM school_years WHERE id=year_id)) THEN
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND course_row_year(TG_TABLE_NAME,to_jsonb(OLD)) IS DISTINCT FROM year_id THEN
    RAISE EXCEPTION 'COURSE_SCOPE_CONFLICT' USING ERRCODE='23514';
  END IF;
  IF year_id IS NULL THEN RAISE EXCEPTION 'COURSE_SCOPE_MISSING' USING ERRCODE='23514'; END IF;
  UPDATE school_years SET revision=revision+1 WHERE id=year_id AND closed_at IS NULL AND active RETURNING id INTO touched;
  IF touched IS NULL THEN RAISE EXCEPTION 'COURSE_CLOSED' USING ERRCODE='23514'; END IF;
  IF TG_OP <> 'DELETE' THEN
    FOREACH field IN ARRAY ARRAY['plan_id','activity_id','document_id','project_id','evidence_id'] LOOP
      IF data->>field IS NULL THEN CONTINUE; END IF;
      ref_table=CASE field WHEN 'plan_id' THEN 'pic_plans' WHEN 'activity_id' THEN 'activities'
        WHEN 'document_id' THEN 'documents' WHEN 'project_id' THEN 'pic_projects' ELSE 'evidences' END;
      EXECUTE format('SELECT course_row_year(%L,to_jsonb(r)) FROM %I r WHERE id=$1',ref_table,ref_table)
        INTO other_year USING (data->>field)::uuid;
      IF other_year IS DISTINCT FROM year_id THEN
        RAISE EXCEPTION 'COURSE_SCOPE_CONFLICT' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_closed_year() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN RAISE EXCEPTION 'COURSE_CLOSED' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.closed_at IS NOT NULL AND (NEW.active OR NOT EXISTS (
    SELECT 1 FROM school_year_snapshots WHERE school_year_id=OLD.id
  )) THEN RAISE EXCEPTION 'COURSE_SNAPSHOT_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NOT NEW.active AND NEW.closed_at IS NULL THEN
    RAISE EXCEPTION 'COURSE_EXPLICIT_CLOSE_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS school_year_closed_guard ON school_years;
CREATE TRIGGER school_year_closed_guard BEFORE UPDATE OR DELETE ON school_years FOR EACH ROW EXECUTE FUNCTION guard_closed_year();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_course_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'COURSE_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  PERFORM id FROM school_years WHERE id=NEW.school_year_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_CLOSED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS school_year_snapshot_guard ON school_year_snapshots;
CREATE TRIGGER school_year_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON school_year_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_course_snapshot();
--> statement-breakpoint
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'pic_plans','pic_dafo','pic_projects','pic_action_selections','pic_indicator_targets','pic_custom_actions',
    'pic_ods_links','pic_ciclope_members','pic_calendar_meetings','pic_snapshots','pic_submission_records',
    'activities','activity_versions','activity_sources','activity_people','activity_indicator_links',
    'documents','document_versions','document_access_grants','evidences','evidence_links',
    'information_requests','information_responses','indicator_observations','school_year_assignments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS course_write_guard ON %I',tab);
    EXECUTE format('CREATE TRIGGER course_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_course_write()',tab);
  END LOOP;
END $$;