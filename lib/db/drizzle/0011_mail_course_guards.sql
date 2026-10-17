-- Communications belong to a single academic-year expediente; a closed year
-- must remain immutable, including contacts, thread state and private files.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'mail_contacts','mail_templates','mail_threads','mail_messages','mail_attachments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS course_write_guard ON %I', tab);
    EXECUTE format(
      'CREATE TRIGGER course_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_course_write()',
      tab
    );
  END LOOP;
END $$;
