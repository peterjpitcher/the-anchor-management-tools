-- Rollback for supabase/migrations/20261027133244_turned_away_logging.sql.
--
-- Restores production as it stood on 26 October 2026: check_table_availability_v06 without the
-- warning line (md5(prosrc) 60eccdcfbfabdee9433d84c0bcbd3ef1 when no other patch has been applied
-- since), service_role only, and no booking_funnel_events table or website_booking_funnel
-- function. Dropping the table discards the funnel rows recorded since; they hold no personal
-- data. Only the warning line is taken out, so a later patch to the same function (for example
-- 20261027133140_kitchen_pacing_counts_hire_and_event_food) is left in place.
--
-- Tested by scripts/testing/turned-away-logging-postgres.py.

DO $unpatch$
DECLARE
  v_oid oid;
  v_count integer;
  v_def text;
  v_anchor constant text :=
    E'EXCEPTION WHEN OTHERS THEN\n'
    || E'  -- Never fail open. A calculation that broke is "unknown", not "available".\n';
  v_added constant text :=
    E'  -- BK-101: say why in the database log, so a broken check is seen and not only answered "unknown".\n'
    || E'  RAISE WARNING ''check_table_availability_v06 failed (date %, party %, purpose %): % %'',\n'
    || E'    p_booking_date, p_party_size, p_purpose, SQLSTATE, SQLERRM;\n';
  v_added_hits integer;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_table_availability_v06';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'turned_away_logging rollback: expected one check_table_availability_v06, found %', v_count;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_added_hits := (length(v_def) - length(replace(v_def, v_anchor || v_added, ''))) / length(v_anchor || v_added);

  IF v_added_hits = 0 THEN
    RAISE NOTICE 'turned_away_logging rollback: no warning line to take out, skipped';
  ELSIF v_added_hits <> 1 THEN
    RAISE EXCEPTION 'turned_away_logging rollback: found % warning lines, expected 1', v_added_hits;
  ELSE
    EXECUTE replace(v_def, v_anchor || v_added, v_anchor);
  END IF;
END
$unpatch$;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;

DROP FUNCTION IF EXISTS public.website_booking_funnel(integer);
DROP TABLE IF EXISTS public.booking_funnel_events;
