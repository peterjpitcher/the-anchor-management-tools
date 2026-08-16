-- Move the remaining booking functions onto the effective-dated hours resolver.
--
-- The versioning work moved every TypeScript reader onto
-- business_hours_for_date, and added an ESLint guard so a new one cannot be added
-- by accident. It missed the PL/pgSQL side entirely, and the guard cannot see
-- inside a function body. So the core booking path kept doing:
--
--   FROM public.business_hours bh
--   LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
--   WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer
--   LIMIT 1
--
-- Correct with one version. With two, LIMIT 1 picks an arbitrary one, so a
-- September booking could be checked against August's hours, or the reverse.
--
-- Found by testing the whole flow rather than reading it: with a September
-- version published in a rolled-back transaction, availability for Wednesday
-- 2 September offered 16:00 to 20:30 and no lunch, because the rule had resolved
-- the baseline Wednesday whose kitchen opens at 16:00. The assertion added in the
-- previous migration then named two more functions with the same fault.
--
-- Harmless in production right now, because only the baseline exists. It breaks
-- the moment a second version is published, which is imminent.
--
-- Patched programmatically from the live definitions rather than retyped: these
-- functions are 200 to 450 lines and carry seasonal deposits, high chairs,
-- kitchen pacing and accessible tables. Retyping them to change two lines is how
-- one of those quietly disappears.

BEGIN;

DO $outer$
DECLARE
  v_target text;
  v_def text;
  v_new text;
  -- Whitespace-tolerant so a reindent does not defeat it.
  v_pattern constant text :=
    'FROM\s+public\.business_hours\s+bh\s*\n(\s*LEFT\s+JOIN\s+public\.special_hours\s+sh\s+ON\s+sh\.date\s*=\s*p_booking_date\s*\n)?\s*WHERE\s+bh\.day_of_week\s*=\s*EXTRACT\(DOW\s+FROM\s+p_booking_date\)::integer\s*\n';
  v_replacement constant text :=
    E'FROM public.business_hours_for_date(p_booking_date) bh\n\\1';
  v_changed integer := 0;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'check_table_availability_v06',
    'create_table_booking_core_v06',
    'create_table_booking_v05'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_target;

    IF v_def IS NULL THEN
      RAISE EXCEPTION '% not found', v_target;
    END IF;

    IF v_def ~ 'business_hours_for_date' THEN
      RAISE NOTICE '% already resolves by date', v_target;
      CONTINUE;
    END IF;

    v_new := regexp_replace(v_def, v_pattern, v_replacement, 'g');

    IF v_new = v_def THEN
      RAISE EXCEPTION
        'Could not find the weekday lookup in %. It has been restructured, so this substitution is unsafe. Re-derive it against the current body.',
        v_target;
    END IF;

    EXECUTE v_new;
    v_changed := v_changed + 1;
    RAISE NOTICE '% now resolves hours by date', v_target;
  END LOOP;

  RAISE NOTICE 'rewrote % booking functions', v_changed;
END $outer$;

-- generate_slots_from_business_hours reads without the schema prefix and uses a
-- loop variable rather than the parameter, so it needs its own substitution.
DO $outer$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_slots_from_business_hours';

  IF v_def IS NULL THEN
    RAISE NOTICE 'generate_slots_from_business_hours not present, skipping';
    RETURN;
  END IF;

  IF v_def ~ 'business_hours_for_date' THEN
    RAISE NOTICE 'generate_slots_from_business_hours already resolves by date';
    RETURN;
  END IF;

  v_new := regexp_replace(
    v_def,
    'FROM\s+business_hours\s*\n\s*WHERE\s+day_of_week\s*=\s*v_day_of_week\s*;',
    E'FROM public.business_hours_for_date(v_current_date);',
    'g');

  IF v_new = v_def THEN
    RAISE EXCEPTION 'Could not find the weekday lookup in generate_slots_from_business_hours.';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'generate_slots_from_business_hours now resolves hours by date';
END $outer$;

-- Post-condition. Any function that answers a question about a DATE must resolve
-- by date. table_booking_matches_service_window_v05 is excluded: it has no caller
-- anywhere and is superseded by table_booking_within_service_window_v06.
-- debug_booking_hours is a diagnostic and is excluded for the same reason, but is
-- listed here so the next person knows it was a decision rather than an oversight.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'check_table_availability_v06',
      'create_table_booking_core_v06',
      'create_table_booking_v05',
      'generate_slots_from_business_hours',
      'table_booking_within_service_window_v06'
    )
    AND pg_get_functiondef(p.oid) !~ 'business_hours_for_date';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These still resolve hours by weekday: %', v_bad;
  END IF;
END $$;

-- Prove the rewrite kept the parts that matter.
DO $$
DECLARE
  v_def text;
  v_needle text;
  v_missing text[] := '{}';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_table_availability_v06';

  FOREACH v_needle IN ARRAY ARRAY[
    'kitchen_pacing_enabled', 'count_high_chairs_in_window',
    'find_table_allocation_candidates', 'outside_reservations',
    'table_booking_within_service_window_v06', 'EXCEPTION WHEN OTHERS THEN'
  ] LOOP
    IF position(v_needle in v_def) = 0 THEN v_missing := v_missing || v_needle; END IF;
  END LOOP;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'check_table_availability_v06 lost content: %', v_missing;
  END IF;
END $$;

COMMIT;
