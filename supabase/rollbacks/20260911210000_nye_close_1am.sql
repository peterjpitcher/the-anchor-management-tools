-- Rollback for supabase/migrations/20260911210000_nye_close_1am.sql: 31 December 2026 closes at
-- 22:00 again. Same guards: production row only, exactly as the migration left it.

DO $rollback$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.special_hours') IS NULL THEN
    RAISE NOTICE 'nye_close_1am rollback: no special_hours table; nothing changed';
    RETURN;
  END IF;

  UPDATE public.special_hours
     SET closes = '22:00:00'::time
   WHERE id = '4a689baa-34c3-4586-8d0a-6a892f58fd47'
     AND date = '2026-12-31'
     AND opens = '12:00:00'::time
     AND closes = '01:00:00'::time
     AND is_closed = false
     AND is_kitchen_closed = true;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'nye_close_1am rollback: expected 1 row at 01:00, matched %', v_rows; END IF;

  RAISE NOTICE 'nye_close_1am rollback: 31 December 2026 closes at 22:00 again';
END
$rollback$;
