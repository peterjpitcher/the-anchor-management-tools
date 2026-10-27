-- Turned-away guests leave a trace (BK-101, BK-097, BK-193, BK-191; customer bookings review of
-- 24 October 2026).
--
-- When the website or this app refuses a booking, or an availability check finds no tables or
-- cannot check at all, nothing kept a countable record: the website wrote one log line, this app
-- kept a bare status code in api_usage that no screen reads, and the live availability function
-- swallowed its own errors and answered "unknown". So a fault between the two systems could
-- refuse a whole type of booking for days unseen, and nobody can tell whether October's halved
-- website table bookings are fewer visitors, "no tables" answers or a broken step.
--
--   * booking_funnel_events: one row per availability answer (recorded by /api/table-bookings/load),
--     per website refusal or failure (reported by the website to /api/website/booking-funnel)
--     and per booking-form signal (opened, submit pressed, blocked, sent). No personal data:
--     no name, phone number, email address or booking reference, only codes, counts, the
--     requested date and party size, the page path with ids stripped, and which API key sent it
--     (so test traffic on its own key can be left out, BK-193). Service role only.
--   * website_booking_funnel(p_weeks): the weekly website funnel for the table bookings reports
--     page (date checks and searches, empty answers, could-not-check answers, refusals, failures
--     and bookings), counting only calls made with keys that can create bookings, which leaves out
--     a read-only key for tests and preview builds. Service role only.
--   * check_table_availability_v06: its catch-all now RAISEs a WARNING with the SQLSTATE and
--     message before answering "unknown", so a broken check shows in the database log. Patched in
--     place, as 20261016180511_kitchen_pacing_lone_party did: the live definition is read with
--     pg_get_functiondef, the warning line is put after the catch-all's comment, and the result
--     is executed. The block refuses to run unless the catch-all appears exactly once and the
--     warning not at all; a second run is a no-op. It touches only the exception block, so it
--     applies in either order with 20261026204729_kitchen_pacing_counts_hire_and_event_food,
--     which patches the pacing test. CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and
--     search_path; the grants are restated at the end anyway. Body checked against production on
--     26 October 2026: md5(prosrc) 60eccdcfbfabdee9433d84c0bcbd3ef1.
--
-- Rollback: tasks/turned-away-logging/rollback.sql. Tested by
-- scripts/testing/turned-away-logging-postgres.py.

CREATE TABLE public.booking_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('website', 'ams')),
  stage text NOT NULL CHECK (stage IN ('availability', 'refused', 'failed', 'form')),
  route text NOT NULL CHECK (route ~ '^[A-Za-z0-9/_.:\[\]-]{1,80}$'),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$'),
  upstream_code text CHECK (upstream_code IS NULL OR upstream_code ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$'),
  http_status smallint CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  booking_date date,
  days_ahead integer CHECK (days_ahead IS NULL OR days_ahead BETWEEN -1 AND 400),
  party_size integer CHECK (party_size IS NULL OR party_size BETWEEN 1 AND 500),
  purpose text CHECK (purpose IS NULL OR purpose IN ('food', 'drinks')),
  calculation_state text CHECK (calculation_state IS NULL OR calculation_state IN ('complete', 'unknown')),
  slots_offered integer CHECK (slots_offered IS NULL OR slots_offered BETWEEN 0 AND 1000),
  public_reason text CHECK (public_reason IS NULL OR public_reason ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$'),
  page_path text CHECK (page_path IS NULL OR (page_path ~ '^/' AND char_length(page_path) <= 120)),
  api_key_id uuid
);

COMMENT ON TABLE public.booking_funnel_events IS
  'Turned-away guests and the website booking funnel (BK-101, BK-097): availability answers, refusals, failures and booking-form signals. No personal data. Service role only.';
COMMENT ON COLUMN public.booking_funnel_events.stage IS
  'availability: one answer from /api/table-bookings/load. refused: a deliberate no the guest can act on. failed: broken on our side, or the two systems disagree. form: a booking form signal (reason_code opened, submit_pressed, blocked or sent).';
COMMENT ON COLUMN public.booking_funnel_events.route IS
  'The website route (api/table-bookings) or this app''s route (table-bookings/load), or for a form signal the form (event_booking).';
COMMENT ON COLUMN public.booking_funnel_events.api_key_id IS
  'The API key that sent it, so a test or preview key can be left out of the funnel (BK-193). No foreign key, so deleting a key keeps its history.';

CREATE INDEX booking_funnel_events_occurred_at_idx ON public.booking_funnel_events (occurred_at);
CREATE INDEX booking_funnel_events_stage_occurred_at_idx ON public.booking_funnel_events (stage, occurred_at);

ALTER TABLE public.booking_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_funnel_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_funnel_events TO service_role;

CREATE FUNCTION public.website_booking_funnel(p_weeks integer DEFAULT 8)
RETURNS TABLE (
  week_start date,
  date_checks bigint,
  searches bigint,
  no_tables bigint,
  could_not_check bigint,
  refused bigint,
  failed bigint,
  bookings bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH settings AS (
    SELECT LEAST(GREATEST(COALESCE(p_weeks, 8), 1), 26) AS weeks,
           date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date AS this_week
  ),
  weeks AS (
    SELECT (s.this_week - 7 * g)::date AS week_start
      FROM settings s, generate_series(0, s.weeks - 1) AS g
  ),
  window_start AS (
    -- Midnight London on the Monday of the first week, as an instant.
    SELECT (min(w.week_start)::timestamp AT TIME ZONE 'Europe/London') AS starts_at FROM weeks w
  ),
  funnel_keys AS (
    -- Keys that can make bookings: the website's own. A read-only key for tests and preview
    -- builds (BK-193) is left out, and so is a key holding every scope.
    SELECT k.id FROM api_keys k WHERE k.permissions @> '["create:bookings"]'::jsonb
  ),
  date_checks AS (
    SELECT date_trunc('week', (u.created_at AT TIME ZONE 'Europe/London'))::date AS week_start, count(*) AS n
      FROM api_usage u, window_start ws
     WHERE u.api_key_id IN (SELECT id FROM funnel_keys)
       AND u.created_at >= ws.starts_at
       AND u.endpoint = '/api/table-bookings/periods'
       AND u.method = 'GET'
     GROUP BY 1
  ),
  events AS (
    SELECT date_trunc('week', (e.occurred_at AT TIME ZONE 'Europe/London'))::date AS week_start,
           count(*) FILTER (WHERE e.stage = 'availability' AND e.purpose = 'drinks') AS searches,
           count(*) FILTER (WHERE e.stage = 'availability' AND e.purpose = 'drinks'
                              AND e.calculation_state = 'complete' AND e.slots_offered = 0) AS no_tables,
           count(*) FILTER (WHERE e.stage = 'availability' AND e.purpose = 'drinks'
                              AND e.calculation_state = 'unknown') AS could_not_check,
           count(*) FILTER (WHERE e.stage = 'refused' AND e.route = 'api/table-bookings') AS refused,
           count(*) FILTER (WHERE e.stage = 'failed' AND e.route = 'api/table-bookings') AS failed
      FROM booking_funnel_events e, window_start ws
     WHERE e.occurred_at >= ws.starts_at
       AND e.api_key_id IN (SELECT id FROM funnel_keys)
     GROUP BY 1
  ),
  bookings AS (
    SELECT date_trunc('week', (b.created_at AT TIME ZONE 'Europe/London'))::date AS week_start, count(*) AS n
      FROM table_bookings b, window_start ws
     WHERE b.created_at >= ws.starts_at
       AND b.source = 'brand_site'
     GROUP BY 1
  )
  SELECT w.week_start,
         COALESCE(dc.n, 0),
         COALESCE(ev.searches, 0),
         COALESCE(ev.no_tables, 0),
         COALESCE(ev.could_not_check, 0),
         COALESCE(ev.refused, 0),
         COALESCE(ev.failed, 0),
         COALESCE(bk.n, 0)
    FROM weeks w
    LEFT JOIN date_checks dc ON dc.week_start = w.week_start
    LEFT JOIN events ev ON ev.week_start = w.week_start
    LEFT JOIN bookings bk ON bk.week_start = w.week_start
   ORDER BY w.week_start DESC;
$function$;

COMMENT ON FUNCTION public.website_booking_funnel(integer) IS
  'Weekly website table booking funnel for the reports page (BK-097), London weeks starting Monday, newest first. Service role only.';

REVOKE ALL ON FUNCTION public.website_booking_funnel(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_booking_funnel(integer) TO service_role;

DO $patch$
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
  v_anchor_hits integer;
  v_added_hits integer;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_table_availability_v06';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'turned_away_logging: expected one check_table_availability_v06, found %', v_count;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_anchor_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  v_added_hits := (length(v_def) - length(replace(v_def, v_anchor || v_added, ''))) / length(v_anchor || v_added);

  IF v_anchor_hits = 1 AND v_added_hits = 1 THEN
    RAISE NOTICE 'turned_away_logging: check_table_availability_v06 already logs its failures, skipped';
  ELSIF v_anchor_hits <> 1 OR v_added_hits <> 0 THEN
    RAISE EXCEPTION 'turned_away_logging: check_table_availability_v06 has % catch-alls and % warnings, expected 1 and 0',
      v_anchor_hits, v_added_hits;
  ELSE
    EXECUTE replace(v_def, v_anchor, v_anchor || v_added);
    RAISE NOTICE 'turned_away_logging: check_table_availability_v06 patched';
  END IF;
END
$patch$;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;
