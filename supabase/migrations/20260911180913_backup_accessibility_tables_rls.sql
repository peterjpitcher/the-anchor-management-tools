-- Row level security on the two 6 September 2026 accessibility backup tables.
--
-- public.backup_accessibility_copy_20260906 (6 rows) and public.backup_accessibility_faq_20260906
-- (1 row) hold copies of event accessibility copy taken before the 6 September rewrite. They were
-- made by hand in production, so no earlier migration creates them. Their row level security is
-- off, which the Supabase security advisor flags: anon has no grants on them, but any signed-in
-- user can read and write them. They hold event copy, no personal data.
--
-- Approved by the owner on 11 September 2026 (item 15): turn row level security on with no
-- policies. Signed-in users then see and change nothing; the service role and the postgres owner
-- bypass row level security, so the backups stay available to an administrator.
--
-- Nothing reads them (checked 11 September 2026): no reference in this repo's src, scripts or
-- supabase folders, none in the website repo, and no function, view, materialised view,
-- trigger or publication in the database mentions them.
--
-- HOW IT GUARDS ITSELF
--   One DO block. Where neither table exists (any database but production) it raises a NOTICE
--   and changes nothing; where only one exists it stops. It also stops unless both have row
--   level security off and no policies, as captured, and it checks the result.
--   Each ALTER takes a brief ACCESS EXCLUSIVE lock on a table nothing uses; lock_timeout is 5s.
--
-- Rollback: supabase/rollbacks/20260911172200_backup_accessibility_tables_rls.sql

DO $migration$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.backup_accessibility_copy_20260906') IS NULL
     AND to_regclass('public.backup_accessibility_faq_20260906') IS NULL THEN
    RAISE NOTICE 'backup_accessibility_tables_rls: backup tables not present, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF to_regclass('public.backup_accessibility_copy_20260906') IS NULL
     OR to_regclass('public.backup_accessibility_faq_20260906') IS NULL THEN
    RAISE EXCEPTION 'backup_accessibility_tables_rls: only one of the two backup tables exists; stopping';
  END IF;

  SELECT count(*) INTO v_rows
    FROM pg_class AS c
   WHERE c.oid IN ('public.backup_accessibility_copy_20260906'::regclass,
                   'public.backup_accessibility_faq_20260906'::regclass)
     AND NOT c.relrowsecurity;
  IF v_rows <> 2 THEN RAISE EXCEPTION 'expected row level security off on both backup tables, found it off on %', v_rows; END IF;

  SELECT count(*) INTO v_rows
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('backup_accessibility_copy_20260906', 'backup_accessibility_faq_20260906');
  IF v_rows <> 0 THEN RAISE EXCEPTION 'expected no policies on the backup tables, found %', v_rows; END IF;

  ALTER TABLE public.backup_accessibility_copy_20260906 ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.backup_accessibility_faq_20260906 ENABLE ROW LEVEL SECURITY;

  SELECT count(*) INTO v_rows
    FROM pg_class AS c
   WHERE c.oid IN ('public.backup_accessibility_copy_20260906'::regclass,
                   'public.backup_accessibility_faq_20260906'::regclass)
     AND c.relrowsecurity;
  IF v_rows <> 2 THEN RAISE EXCEPTION 'row level security is on for % of the 2 backup tables', v_rows; END IF;

  RAISE NOTICE 'backup_accessibility_tables_rls: row level security on for both backup tables';
END
$migration$;
