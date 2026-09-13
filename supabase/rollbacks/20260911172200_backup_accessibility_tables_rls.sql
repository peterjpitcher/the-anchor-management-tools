-- Rollback for 20260911172200_backup_accessibility_tables_rls.sql
--
-- Turns row level security back off on the two accessibility backup tables, which is how
-- production held them on 11 September 2026 (off, no policies). Hand-run SQL, like everything in
-- this folder. Doing so reopens the Supabase advisor finding: any signed-in user could read and
-- write them again.

DO $rollback$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.backup_accessibility_copy_20260906') IS NULL
     AND to_regclass('public.backup_accessibility_faq_20260906') IS NULL THEN
    RAISE NOTICE 'rollback backup_accessibility_tables_rls: backup tables not present; nothing changed';
    RETURN;
  END IF;
  IF to_regclass('public.backup_accessibility_copy_20260906') IS NULL
     OR to_regclass('public.backup_accessibility_faq_20260906') IS NULL THEN
    RAISE EXCEPTION 'rollback backup_accessibility_tables_rls: only one of the two backup tables exists; stopping';
  END IF;

  SELECT count(*) INTO v_rows
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('backup_accessibility_copy_20260906', 'backup_accessibility_faq_20260906');
  IF v_rows <> 0 THEN RAISE EXCEPTION 'policies have been added to the backup tables since (found %); stopping', v_rows; END IF;

  ALTER TABLE public.backup_accessibility_copy_20260906 DISABLE ROW LEVEL SECURITY;
  ALTER TABLE public.backup_accessibility_faq_20260906 DISABLE ROW LEVEL SECURITY;

  SELECT count(*) INTO v_rows
    FROM pg_class AS c
   WHERE c.oid IN ('public.backup_accessibility_copy_20260906'::regclass,
                   'public.backup_accessibility_faq_20260906'::regclass)
     AND NOT c.relrowsecurity;
  IF v_rows <> 2 THEN RAISE EXCEPTION 'row level security is off for % of the 2 backup tables', v_rows; END IF;

  RAISE NOTICE 'rollback backup_accessibility_tables_rls: row level security off again for both backup tables';
END
$rollback$;
