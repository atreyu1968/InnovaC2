-- Also replayable after development schema push; never creates or replaces application data.
DROP TRIGGER IF EXISTS learning_spaces_course_guard ON learning_spaces;
CREATE TRIGGER learning_spaces_course_guard BEFORE INSERT OR UPDATE OR DELETE ON learning_spaces
FOR EACH ROW EXECUTE FUNCTION guard_course_write();
DROP TRIGGER IF EXISTS space_reservations_course_guard ON space_reservations;
CREATE TRIGGER space_reservations_course_guard BEFORE INSERT OR UPDATE OR DELETE ON space_reservations
FOR EACH ROW EXECUTE FUNCTION guard_course_write();
DROP TRIGGER IF EXISTS space_versions_course_guard ON space_versions;
CREATE TRIGGER space_versions_course_guard BEFORE INSERT OR UPDATE OR DELETE ON space_versions
FOR EACH ROW EXECUTE FUNCTION guard_course_write();
CREATE OR REPLACE FUNCTION guard_space_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM school_years WHERE id=NEW.school_year_id AND center_id=NEW.center_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_CLOSED_OR_MISMATCH' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM learning_spaces WHERE school_year_id=NEW.school_year_id AND kind=ANY(NEW.space_kinds)) <> cardinality(NEW.space_kinds) THEN
    RAISE EXCEPTION 'SPACE_NOT_CONFIGURED' USING ERRCODE='23514';
  END IF;
  IF NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT id FROM activities WHERE id=NEW.activity_id AND center_id=NEW.center_id AND school_year_id=NEW.school_year_id
  ) THEN RAISE EXCEPTION 'COURSE_REFERENCE_MISMATCH' USING ERRCODE='23514'; END IF;
  IF NEW.status <> 'cancelada' AND EXISTS (
    SELECT id FROM space_reservations WHERE school_year_id=NEW.school_year_id AND id<>NEW.id
      AND status<>'cancelada' AND space_kinds && NEW.space_kinds
      AND starts_at<NEW.ends_at AND ends_at>NEW.starts_at
  ) THEN RAISE EXCEPTION 'SPACE_OVERLAP' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS space_reservation_integrity ON space_reservations;
CREATE TRIGGER space_reservation_integrity BEFORE INSERT OR UPDATE ON space_reservations
FOR EACH ROW EXECUTE FUNCTION guard_space_reservation();
CREATE OR REPLACE FUNCTION guard_space_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SPACE_HISTORY_IMMUTABLE' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS space_history_immutable ON space_versions;
CREATE TRIGGER space_history_immutable BEFORE UPDATE OR DELETE ON space_versions
FOR EACH ROW EXECUTE FUNCTION guard_space_history();
