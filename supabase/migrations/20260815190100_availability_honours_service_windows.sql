-- Phase 2b: availability stops offering times the kitchen is not serving.
--
-- Pairs with 20260815170200, which added the rule and enforced it on creation.
-- Without this, the UI would offer 15:30 on a two-service day and the creation
-- guard would then refuse it. Still DORMANT: the predicate returns true for every
-- call while service_window_enforcement_enabled is false.
--
-- Why the body is patched programmatically
-- ----------------------------------------
-- check_table_availability_v06 is ~240 lines and has been replaced several times
-- (availability_v06, kitchen pacing, high chairs, accessible tables). Retyping it
-- into a migration to insert seven lines is how a later fix gets silently dropped:
-- three of six functions in the original spec for this work cited a superseded
-- migration as their source. So instead of reproducing the body, this reads the
-- LIVE definition, asserts the anchor line is present, injects after it, and
-- executes the result. If the function has changed shape, the anchor is missing
-- and this aborts rather than guessing.
--
-- If a future migration replaces check_table_availability_v06, re-run this one.
-- The post-condition below will tell you it is needed: it fails if the injection
-- is absent after the rewrite.
--
-- Verified against production before commit, on a copy under a throwaway name:
--   * dormant, the patched copy returned byte-identical jsonb to the live
--     function for 7 date/purpose combinations
--   * enabled, against a two-service day, the offered times ran
--     14:15, 14:30, 16:00, 16:15, 16:30, dropping 14:45 to 15:45
--   * drinks were untouched, 39 slots either way

-- The predicate must already exist. check_table_availability_v06 swallows every
-- error and returns zero slots, so injecting a call to a missing function would
-- not fail loudly: the website would simply stop showing any availability, with
-- nothing in the logs. Refuse to inject unless the target is there.
DO $$
BEGIN
  IF to_regprocedure('public.table_booking_within_service_window_v06(date, time without time zone, text, boolean)') IS NULL THEN
    RAISE EXCEPTION
      'table_booking_within_service_window_v06 does not exist. Apply 20260815190000 first: injecting a call to a missing function would silently empty availability rather than erroring.';
  END IF;
END $$;

DO $outer$
DECLARE
  v_def text;
  v_anchor constant text := '    v_slot_time := make_time((v_minutes / 60) % 24, v_minutes % 60, 0);';
  v_marker constant text := 'table_booking_within_service_window_v06';
  v_inject text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_table_availability_v06';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'check_table_availability_v06 not found';
  END IF;

  IF position(v_marker in v_def) > 0 THEN
    RAISE NOTICE 'availability already honours service windows, nothing to do';
    RETURN;
  END IF;

  IF position(v_anchor in v_def) = 0 THEN
    RAISE EXCEPTION
      'check_table_availability_v06 no longer contains the expected slot-ladder line. It has been restructured, so this injection is unsafe. Re-derive the patch against the current body.';
  END IF;

  -- Nested rather than ANDed with the purpose test: PostgreSQL does not guarantee
  -- short-circuit evaluation of AND, so a combined condition still calls the
  -- predicate for a drinks booking. That was observed during verification.
  v_inject := v_anchor || E'\n' ||
'
    -- Do not offer a time the kitchen is not serving. Same rule as the creation
    -- guard (assert_booking_within_service_window), so the two cannot disagree.
    IF p_purpose = ''food'' THEN
      IF NOT public.table_booking_within_service_window_v06(
               p_booking_date, v_slot_time, p_purpose, false) THEN
        v_minutes := v_minutes + v_slot_step;
        CONTINUE;
      END IF;
    END IF;';

  EXECUTE replace(v_def, v_anchor, v_inject);
END $outer$;

-- Post-conditions. The injection must be present, and the distinctive pieces of
-- the original must all have survived it, so a botched rewrite cannot pass.
DO $$
DECLARE
  v_def text;
  v_missing text[] := '{}';
  v_needle text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_table_availability_v06';

  FOREACH v_needle IN ARRAY ARRAY[
    'table_booking_within_service_window_v06',   -- the injection itself
    'kitchen_pacing_enabled',                    -- kitchen pacing gate
    'count_high_chairs_in_window',               -- high chairs
    'find_table_allocation_candidates',          -- the table picker
    'outside_reservations',                      -- outside seating
    'requires_accessible_table',                 -- accessible tables
    'table_booking_max_party_online',            -- online party ceiling
    'EXCEPTION WHEN OTHERS THEN'                 -- never fail open
  ] LOOP
    IF position(v_needle in v_def) = 0 THEN
      v_missing := v_missing || v_needle;
    END IF;
  END LOOP;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'check_table_availability_v06 lost expected content: %', v_missing;
  END IF;
END $$;
