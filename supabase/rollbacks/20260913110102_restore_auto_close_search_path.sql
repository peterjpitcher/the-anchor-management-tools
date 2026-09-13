-- Rollback for supabase/migrations/20260913110102_restore_auto_close_search_path.sql.
--
-- This puts auto_close_past_event_tasks() back to having no pinned search_path, which is the
-- SECURITY DEFINER hijack surface the forward migration closes. It exists so the pair is complete
-- and so an unpin is a deliberate, recorded act rather than an ad-hoc statement. There is no
-- operational reason to run it: the setting changes no behaviour and the function ran with it from
-- 27 May to 17 August 2026.
--
-- It only unpins a function that carries exactly the value the forward migration set, so it cannot
-- strip a different setting somebody has since chosen.

DO $rollback$
DECLARE
  v_config text[];
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regprocedure('public.auto_close_past_event_tasks()') IS NULL THEN
    RAISE NOTICE 'restore_auto_close_search_path rollback: function absent; nothing changed';
    RETURN;
  END IF;

  SELECT proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'auto_close_past_event_tasks';

  IF v_config IS NULL THEN
    RAISE NOTICE 'restore_auto_close_search_path rollback: already unpinned; nothing changed';
    RETURN;
  END IF;

  IF NOT (v_config = ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'rollback refused: proconfig is %, not the value the migration set', v_config;
  END IF;

  ALTER FUNCTION public.auto_close_past_event_tasks() RESET search_path;

  SELECT proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'auto_close_past_event_tasks';
  IF v_config IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not unpin (proconfig %)', v_config;
  END IF;

  RAISE NOTICE 'restore_auto_close_search_path rollback: 1 function unpinned';
END
$rollback$;
