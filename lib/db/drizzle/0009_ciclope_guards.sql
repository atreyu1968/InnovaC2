-- The generic course guard knows direct school_year_id columns. Keep CICLOPE
-- changes in the same locking/revision protocol as the rest of the expediente.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['ciclope_policies','ciclope_meetings','ciclope_versions','ciclope_tasks','ciclope_notices'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS course_write_guard ON %I', tab);
    EXECUTE format('CREATE TRIGGER course_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_course_write()', tab);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_ciclope_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CICLOPE_VERSION_IMMUTABLE' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ciclope_version_immutable ON ciclope_versions;
CREATE TRIGGER ciclope_version_immutable BEFORE UPDATE OR DELETE ON ciclope_versions
FOR EACH ROW EXECUTE FUNCTION guard_ciclope_version();
