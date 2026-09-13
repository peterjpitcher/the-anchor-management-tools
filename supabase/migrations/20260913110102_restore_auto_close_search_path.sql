-- Restore the search_path on auto_close_past_event_tasks(), lost in a CREATE OR REPLACE today.
--
-- APPLIED to production on 13 September 2026 through the Supabase MCP, which recorded it at
-- version 20260913110102. This file is named after that version, as supabase/migrations/README.md
-- requires. The ledger's statement is this file with the comment block above the DO condensed:
-- md5 ff7bf5cf4fffd81de2440c631c7b45eb, 2,169 bytes. The DO block itself is identical.
--
-- 20260527062350_security_hardening_2026_05_27 pinned this function with
-- `ALTER FUNCTION public.auto_close_past_event_tasks() SET search_path = public, pg_catalog;`.
-- Postgres keeps that setting in pg_proc.proconfig, and a CREATE OR REPLACE that does not restate
-- it clears it. 20260913101234_remove_paid_advertising_event_todo (applied to production earlier
-- today as version 20260913101708) replaced the body without the SET clause, so the setting is
-- gone.
--
-- WHY IT MATTERS
--   The function is SECURITY DEFINER, so it runs as its owner. With no pinned search_path it
--   resolves unqualified names through whatever the caller's search_path happens to be, which is
--   the standard SECURITY DEFINER hijack: anyone able to create an object in a schema earlier on
--   that path can have it called with the owner's rights. Checked read-only on 13 September 2026:
--   prosecdef true, proconfig NULL, and it was the only one of 247 SECURITY DEFINER functions in
--   public with proconfig NULL. EXECUTE is still correctly revoked from anon, authenticated and
--   PUBLIC (20260527081351), so this is a hardening gap rather than an open door, but it is the
--   gap that hardening migration existed to close.
--
-- WHAT CHANGES (1 function, 1 setting)
--   [P1] public.auto_close_past_event_tasks(): proconfig NULL becomes
--        {search_path=public, pg_catalog}, exactly the value 20260527062350 set. The body, the
--        owner, the volatility and the grants are untouched, and ALTER FUNCTION ... SET does not
--        rewrite the body. The function ran with this setting from 27 May to 17 August 2026, so
--        the value is known to work: every object it touches is in public.
--
-- HOW IT GUARDS ITSELF
--   One DO block. The production marker is checked first, on its own IF, because Postgres plans
--   the whole condition and a missing function would error rather than skip. The ALTER runs only
--   when proconfig is NULL, so a re-run is a no-op, and the block then reads proconfig back and
--   raises unless it holds the two entries. Nothing else in the schema moves.
--
-- Rollback: supabase/rollbacks/20260913110102_restore_auto_close_search_path.sql
--   (the rollback exists for completeness; putting the hole back is not something to do)

DO $migration$
DECLARE
  v_config text[];
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regprocedure('public.auto_close_past_event_tasks()') IS NULL THEN
    RAISE NOTICE 'restore_auto_close_search_path: function absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  SELECT proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'auto_close_past_event_tasks';

  -- [P1] pin the resolution path back to what the May hardening set
  IF v_config IS NULL THEN
    ALTER FUNCTION public.auto_close_past_event_tasks() SET search_path = public, pg_catalog;
  ELSE
    RAISE NOTICE 'restore_auto_close_search_path: already pinned to %, nothing changed', v_config;
  END IF;

  SELECT proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'auto_close_past_event_tasks';
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION '[P1] search_path did not come out as checked (proconfig %)', v_config;
  END IF;

  RAISE NOTICE 'restore_auto_close_search_path: 1 function pinned (1 setting)';
END
$migration$;
