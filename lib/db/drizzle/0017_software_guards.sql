CREATE OR REPLACE FUNCTION guard_software_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_year uuid; parent_center uuid;
BEGIN
  IF TG_TABLE_NAME='software_products' THEN
    SELECT school_year_id,center_id INTO parent_year,parent_center FROM software_catalogs WHERE id=NEW.catalog_id;
  ELSIF TG_TABLE_NAME='software_records' THEN
    SELECT school_year_id,center_id INTO parent_year,parent_center FROM software_products WHERE id=NEW.product_id;
    IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
      SELECT id FROM software_records WHERE id=NEW.supersedes_id AND product_id=NEW.product_id AND source='manual'
    ) THEN RAISE EXCEPTION 'COURSE_REFERENCE_MISMATCH' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT p.school_year_id,p.center_id INTO parent_year,parent_center
      FROM pic_projects p0 JOIN pic_plans p ON p.id=p0.plan_id WHERE p0.id=NEW.pic_project_id;
    IF NEW.pic_project_id IS NULL THEN RETURN NEW; END IF;
  END IF;
  IF parent_year IS DISTINCT FROM NEW.school_year_id OR parent_center IS DISTINCT FROM NEW.center_id THEN
    RAISE EXCEPTION 'COURSE_REFERENCE_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['software_catalogs','software_products','software_records','software_versions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS software_course_guard ON %I',tab);
    EXECUTE format('CREATE TRIGGER software_course_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_course_write()',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['software_catalogs','software_products','software_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS software_reference_guard ON %I',tab);
    EXECUTE format('CREATE TRIGGER software_reference_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_software_reference()',tab);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION guard_software_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SOFTWARE_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS software_history_guard ON software_records;
CREATE TRIGGER software_history_guard BEFORE UPDATE OR DELETE ON software_records
  FOR EACH ROW EXECUTE FUNCTION guard_software_history();
DROP TRIGGER IF EXISTS software_history_guard ON software_versions;
CREATE TRIGGER software_history_guard BEFORE UPDATE OR DELETE ON software_versions
  FOR EACH ROW EXECUTE FUNCTION guard_software_history();
