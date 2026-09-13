-- Rollback for supabase/migrations/20260913120000_sunday_lunch_service_message_walk_in_launch.sql.
--
-- Puts the old pre-order message back on service_statuses.sunday_lunch, exactly as captured on
-- 13 September 2026, and restores the 4 November 2025 `updated_at` that row carried. Guarded the
-- same way: production only, the service_code plus the md5 the migration produced, exactly one
-- row, and the message must come back at the md5 it had before it ran.
--
-- Note what putting it back means: the old text states a pre-order, a Saturday cutoff and a £5
-- per person deposit, all three of which the SSOT retired at the 17 May 2026 walk-in launch. Run
-- this only to undo a bad apply, never as a way of restoring the wording.

DO $rollback$
DECLARE
  v_rows integer;
  v_message_md5 text;
  c_old CONSTANT text :=
    'Sunday lunch bookings require pre-order with £5 per person deposit by 1pm Saturday.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.service_statuses') IS NULL THEN
    RAISE NOTICE 'sunday_lunch_service_message rollback: no service_statuses table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_statuses WHERE service_code = 'sunday_lunch') THEN
    RAISE NOTICE 'sunday_lunch_service_message rollback: no sunday_lunch row, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] the message the site shows when Sunday roast is unavailable
  UPDATE public.service_statuses
     SET message = c_old,
         updated_at = '2025-11-04 13:08:04.453861+00'::timestamptz
   WHERE service_code = 'sunday_lunch'
     AND md5(message) = 'ba684d021cc130948200880718f83cd5';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [P1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(message) INTO v_message_md5 FROM public.service_statuses WHERE service_code = 'sunday_lunch';
  IF v_message_md5 IS DISTINCT FROM 'f62c68e8ef33c5da4ecd9c921eeb49ef' THEN
    RAISE EXCEPTION 'rollback [P1] did not come back as captured (message md5 %)', v_message_md5;
  END IF;

  RAISE NOTICE 'sunday_lunch_service_message rollback: 1 service status restored (1 field)';
END
$rollback$;
