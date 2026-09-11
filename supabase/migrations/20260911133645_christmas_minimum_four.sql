-- Christmas dinner bookings from 4 guests, not 6.
--
-- On 6 September 2026 the owner lowered the Christmas dinner minimum from 6 guests to 4, on every
-- day of the window (website docs/SSOT.md section 7, SSOT.json
-- christmas_2026.booking_rules.min_party_size). The website already says 4 or more. This database
-- still refused a party of 4 or 5 in three places (read-only check of production, 11 September
-- 2026):
--
--   1. create_table_booking_core_v06 raised "Christmas bookings are for 6 guests or more." for any
--      booking made with the christmas purpose, which is how staff book Christmas from FOH.
--   2. create_table_booking_v05, the older entry point that authenticated can still execute,
--      raised the same.
--   3. The christmas-2026 booking period held min_party_size = 6, so resolve_table_booking_deposit
--      answered period_party_too_small when a guest on the website said yes to "Is this a
--      Christmas dinner booking?" for fewer than 6.
--
-- WHAT CHANGES
--   In each function, two lines: "IF p_party_size < 6 THEN" becomes "IF p_party_size < 4 THEN",
--   and the message becomes "Christmas bookings are for 4 guests or more.". The message keeps the
--   "Christmas bookings " prefix that extractChristmasRuleErrorMessage needs to show it to staff
--   word for word. Then one data row, in its own section. Nothing else moves: not the 20-guest
--   ceiling, the 24-hour notice rule, the GBP 10 per head Christmas deposit, the 15-guest group
--   deposit, or the unrelated "p_party_size <= 6" turn-time band in create_table_booking_core_v06.
--
-- WHERE THE FUNCTION TEXT CAME FROM
--   Not retyped. Each CREATE OR REPLACE below is production's pg_get_functiondef output with only
--   those two lines edited. The captured text matched production byte for byte before editing:
--     create_table_booking_core_v06  33054 characters, md5 f8f7f2b84b4fdf9ff7cb5266416a21c8
--     create_table_booking_v05       24158 characters, md5 988a2a5ddefd576aef392edaf70c67dc
--   It is the body from 20260803000200 (core) and 20260722121141 (v05), each with the
--   business-hours substitution that 20260816090100 made in place.
--
--   Carrying the full text also puts the live v05 back into the repo's history. Replaying these
--   files in name order does not reproduce it: 20260726000001 and 20260728000000 sort after the
--   recovered 20260722121141 and recreate v05 without its Christmas rules, so a rebuilt database
--   had no Christmas minimum on v05 at all (seen on a local replay, 11 September 2026).
--
-- Rollback: supabase/rollbacks/20260911133645_christmas_minimum_four.sql

BEGIN;

-- Fail fast rather than queue behind a long transaction holding the Christmas period row.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. create_table_booking_core_v06. Production text; only the Christmas minimum and its
--    message differ.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_table_booking_core_v06(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text, p_bypass_cutoff boolean, p_deposit_waived boolean, p_bypass_pacing boolean, p_high_chair_count integer, p_outside_seating boolean, p_requires_accessible_table boolean, p_channel text, p_pin boolean, p_max_party_size integer, p_overrides table_allocation_overrides, p_actor_id uuid, p_booking_period_id uuid, p_booking_period_answer boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purpose text;
  v_is_christmas boolean := false;
  v_booking_type public.table_booking_type;
  v_booking_status public.table_booking_status;
  v_is_sunday boolean;

  v_booking_start_local timestamp without time zone;
  v_booking_start timestamptz;
  v_booking_end timestamptz;          -- what the guest is told
  v_occupancy_end timestamptz;        -- what the table is held for

  v_hours_row RECORD;

  v_pub_open_minutes integer;
  v_pub_close_minutes integer;
  v_pub_close_service_minutes integer;
  v_pub_booking_minutes integer;

  v_kitchen_open_minutes integer;
  v_kitchen_close_minutes integer;
  v_kitchen_close_service_minutes integer;
  v_kitchen_booking_minutes integer;

  v_duration_minutes integer;
  v_turnaround_minutes integer := 0;

  v_drinks_near_close_allowed boolean := false;

  v_selected_table_id uuid;
  v_selected_table_ids uuid[];
  v_selected_table_names text[];
  v_selected_table_display_name text;

  v_table_booking_id uuid;
  v_booking_reference text;

  v_deposit_required boolean := false;
  v_hold_expires_at timestamptz;
  v_now timestamptz := NOW();
  v_party_size_eff integer;
  v_deposit_amount numeric(10, 2);

  v_sunday_preorder_cutoff_at timestamptz;

  v_pacing_enabled boolean;
  v_pacing_window integer;
  v_pace integer;
  v_reserve integer;
  v_ovr_pace integer;
  v_ovr_reserve integer;
  v_ceiling integer;
  v_center_minutes integer;
  v_half numeric;
  v_existing_covers integer;

  v_high_chair_inventory integer;
  v_high_chairs_granted integer := 0;

  v_outside_capacity integer;
  v_outside_count integer;
  v_outside_needed integer;
  v_outside_used integer;

  -- The seasonal period, and the single resolved deposit that comes out of it.
  v_period public.booking_periods;
  v_period_id uuid;
  v_period_accepted boolean := false;
  v_min_notice_hours integer := 0;
  v_deposit jsonb;
  v_deposit_rule text;
  v_deposit_basis text;
  v_deposit_rate numeric(10, 2);
  v_deposit_refund_days integer;
  v_deposit_refund_policy text;
BEGIN
  -- =========================================================================
  -- THE GATE. Off means v05, exactly, end to end.
  -- =========================================================================
  IF NOT public.get_setting_bool('table_allocation_v06_enabled', false) THEN
    -- v05 knows nothing about seasonal periods: it would take the booking and charge the old
    -- party-size rule, silently. A guest who accepted a seasonal offer is refused loudly instead.
    -- Production has run with this flag ON since 2026-08-01, so this is a guard, not a path.
    IF COALESCE(p_booking_period_answer, false) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'seasonal_needs_v06');
    END IF;

    RETURN public.create_table_booking_v05(
      p_customer_id, p_booking_date, p_booking_time, p_party_size, p_booking_purpose,
      p_notes, p_sunday_lunch, p_source, p_bypass_cutoff, p_deposit_waived,
      p_bypass_pacing, p_high_chair_count, p_outside_seating
    );
  END IF;

  -- =========================================================================
  -- Guards, carried over from v05 unchanged except the party-size ceiling.
  -- =========================================================================
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_customer');
  END IF;

  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_datetime');
  END IF;

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_party_size');
  END IF;

  -- Was a hard "p_party_size >= 21". Now the caller's ceiling, so the website refuses 21 while
  -- staff can take a large booking in the moment.
  IF p_party_size > COALESCE(p_max_party_size, 20) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  v_purpose := LOWER(TRIM(COALESCE(p_booking_purpose, 'food')));
  v_is_christmas := (v_purpose = 'christmas');
  IF v_is_christmas THEN
    v_purpose := 'food';
    IF p_party_size < 4 THEN
      RAISE EXCEPTION 'Christmas bookings are for 4 guests or more.' USING ERRCODE = '22023';
    END IF;
    IF p_party_size > 20 THEN
      RAISE EXCEPTION 'Christmas bookings for more than 20 guests are arranged as private hire. Please contact manager@the-anchor.pub, 01753 682707, or WhatsApp 01753 682707.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_purpose NOT IN ('food', 'drinks') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_purpose');
  END IF;

  -- =========================================================================
  -- The seasonal period for this date, resolved SERVER SIDE.
  --
  -- The browser sends p_booking_period_id and p_booking_period_answer. Neither is trusted for
  -- money. The period that applies is whichever LIVE period covers the booking date, which the
  -- exclusion constraint on booking_periods guarantees is at most one. A supplied id that names a
  -- different period is a stale form or a tampered request, and is refused rather than priced,
  -- because otherwise a caller could name a cheaper season than the one it is booking into.
  -- =========================================================================
  SELECT * INTO v_period FROM public.get_booking_period_for_date(p_booking_date);
  v_period_id := v_period.id;

  IF p_booking_period_id IS NOT NULL AND p_booking_period_id IS DISTINCT FROM v_period_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'period_date_mismatch');
  END IF;

  -- The legacy Christmas purpose is an acceptance of a Christmas-kind period, so the two ways in
  -- produce one booking rather than two behaviours.
  v_period_accepted := v_period_id IS NOT NULL
    AND (COALESCE(p_booking_period_answer, false)
      OR (v_is_christmas AND v_period.period_kind = 'christmas'));

  -- Accepting an offer that is not running is a stale client, not a booking.
  IF COALESCE(p_booking_period_answer, false) AND v_period_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'period_not_available');
  END IF;

  -- Minimum notice belongs to the period. Christmas keeps its long-standing 24 hours when nothing
  -- says otherwise, and its wording, because /api/table-bookings and /api/foh/bookings pass a
  -- message starting "Christmas bookings " straight through to the person who typed the booking.
  v_min_notice_hours := COALESCE(
    CASE WHEN v_period_accepted THEN v_period.min_notice_hours ELSE NULL END,
    CASE WHEN v_is_christmas THEN 24 ELSE 0 END,
    0);

  IF v_min_notice_hours > 0
     AND NOT COALESCE(p_bypass_cutoff, false)
     AND (p_booking_date + p_booking_time)
         < ((NOW() AT TIME ZONE 'Europe/London') + (v_min_notice_hours || ' hours')::interval) THEN
    IF v_is_christmas THEN
      RAISE EXCEPTION 'Christmas bookings need at least % hours notice.', v_min_notice_hours
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
  END IF;

  v_is_sunday := EXTRACT(DOW FROM p_booking_date)::integer = 0;
  IF COALESCE(p_sunday_lunch, false) AND NOT v_is_sunday THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'sunday_lunch_requires_sunday');
  END IF;

  -- A period may pin an existing booking_type value, which is how Christmas keeps the enum value
  -- the rest of the app already knows. Every other season stays 'regular' with the period
  -- snapshotted alongside it, so adding a season never needs an ALTER TYPE.
  v_booking_type := CASE
    WHEN v_is_christmas THEN 'christmas'::public.table_booking_type
    WHEN v_period_accepted AND v_period.legacy_booking_type IS NOT NULL THEN v_period.legacy_booking_type
    WHEN COALESCE(p_sunday_lunch, false) THEN 'sunday_lunch'::public.table_booking_type
    ELSE 'regular'::public.table_booking_type
  END;

  v_booking_start_local := (p_booking_date::text || ' ' || p_booking_time::text)::timestamp;
  v_booking_start := v_booking_start_local AT TIME ZONE 'Europe/London';

  IF v_booking_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'in_past');
  END IF;

  SELECT
    bh.day_of_week,
    COALESCE(sh.is_closed, bh.is_closed, false) AS is_closed,
    COALESCE(sh.is_kitchen_closed, bh.is_kitchen_closed, false) AS is_kitchen_closed,
    COALESCE(sh.opens, bh.opens) AS opens,
    COALESCE(sh.closes, bh.closes) AS closes,
    COALESCE(sh.kitchen_opens, bh.kitchen_opens) AS kitchen_opens,
    COALESCE(sh.kitchen_closes, bh.kitchen_closes) AS kitchen_closes
  INTO v_hours_row
  FROM public.business_hours_for_date(p_booking_date) bh
  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  IF COALESCE(v_hours_row.is_closed, false)
     OR v_hours_row.opens IS NULL OR v_hours_row.closes IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  v_pub_open_minutes := (EXTRACT(HOUR FROM v_hours_row.opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.opens)::integer;
  v_pub_close_minutes := (EXTRACT(HOUR FROM v_hours_row.closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.closes)::integer;
  v_pub_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;

  v_pub_close_service_minutes := CASE
    WHEN v_pub_close_minutes <= v_pub_open_minutes THEN v_pub_close_minutes + 1440
    ELSE v_pub_close_minutes
  END;

  IF v_pub_close_minutes <= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_open_minutes THEN
    v_pub_booking_minutes := v_pub_booking_minutes + 1440;
  END IF;

  IF NOT (v_pub_booking_minutes >= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_close_service_minutes) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  SELECT
    COALESCE(
      CASE
        WHEN jsonb_typeof(value) = 'boolean' THEN (value::text)::boolean
        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::numeric <> 0
        WHEN jsonb_typeof(value) = 'string' THEN LOWER(TRIM(BOTH '"' FROM value::text)) IN ('1','true','yes','y','on')
        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
          LOWER(value->>'enabled') IN ('1','true','yes','y','on'),
          LOWER(value->>'allow') IN ('1','true','yes','y','on')
        )
        ELSE NULL
      END,
      false
    )
  INTO v_drinks_near_close_allowed
  FROM public.system_settings
  WHERE key IN (
    'table_booking_drinks_near_close_allowed',
    'table_bookings_drinks_near_close_allowed',
    'drinks_near_close_allowed'
  )
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_purpose = 'food' OR COALESCE(p_sunday_lunch, false) THEN
    IF COALESCE(v_hours_row.is_kitchen_closed, false)
       OR v_hours_row.kitchen_opens IS NULL
       OR v_hours_row.kitchen_closes IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
    END IF;

    v_kitchen_open_minutes := (EXTRACT(HOUR FROM v_hours_row.kitchen_opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.kitchen_opens)::integer;
    v_kitchen_close_minutes := (EXTRACT(HOUR FROM v_hours_row.kitchen_closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.kitchen_closes)::integer;
    v_kitchen_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;

    v_kitchen_close_service_minutes := CASE
      WHEN v_kitchen_close_minutes <= v_kitchen_open_minutes THEN v_kitchen_close_minutes + 1440
      ELSE v_kitchen_close_minutes
    END;

    IF v_kitchen_close_minutes <= v_kitchen_open_minutes AND v_kitchen_booking_minutes < v_kitchen_open_minutes THEN
      v_kitchen_booking_minutes := v_kitchen_booking_minutes + 1440;
    END IF;

    IF NOT (v_kitchen_booking_minutes >= v_kitchen_open_minutes AND v_kitchen_booking_minutes < v_kitchen_close_service_minutes) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
    END IF;

    IF v_kitchen_booking_minutes > (v_kitchen_close_service_minutes - 30)
       AND NOT COALESCE(p_bypass_cutoff, false) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  END IF;

  IF v_purpose = 'drinks' AND NOT COALESCE(v_drinks_near_close_allowed, false)
     AND NOT COALESCE(p_bypass_cutoff, false) THEN
    IF v_pub_booking_minutes > (v_pub_close_service_minutes - 30) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  END IF;

  -- =========================================================================
  -- Duration. Turn times by party size when enabled; otherwise the flat v05
  -- values, so the setting alone decides which model is in force.
  -- =========================================================================
  IF public.get_setting_bool('turn_times_enabled', false) THEN
    v_duration_minutes := CASE
      WHEN p_party_size <= 2 THEN public.get_setting_int('turn_time_minutes_1_2', 90)
      WHEN p_party_size <= 4 THEN public.get_setting_int('turn_time_minutes_3_4', 105)
      WHEN p_party_size <= 6 THEN public.get_setting_int('turn_time_minutes_5_6', 120)
      ELSE public.get_setting_int('turn_time_minutes_7_plus', 150)
    END;
    IF v_is_sunday THEN
      v_duration_minutes := v_duration_minutes + public.get_setting_int('turn_time_sunday_uplift_minutes', 15);
    END IF;
    v_turnaround_minutes := public.get_setting_int('turnaround_gap_minutes', 15);
  ELSE
    v_duration_minutes := CASE
      WHEN COALESCE(p_sunday_lunch, false) THEN 120
      WHEN v_purpose = 'food' THEN 120
      ELSE 90
    END;
    v_turnaround_minutes := 0;
  END IF;

  v_duration_minutes := GREATEST(30, v_duration_minutes);
  v_booking_end   := v_booking_start + make_interval(mins => v_duration_minutes);
  -- The gap lengthens the TABLE hold, never the time quoted to the guest.
  v_occupancy_end := v_booking_end + make_interval(mins => GREATEST(0, v_turnaround_minutes));

  -- =========================================================================
  -- One venue-level lock, taken BEFORE selection. In v05 the lock came after,
  -- so a lost race became a refusal rather than a retry. Keyed on the venue
  -- rather than the date, so two bookings either side of midnight cannot slip
  -- past each other (review finding F8 on locking).
  -- =========================================================================
  PERFORM pg_advisory_xact_lock(hashtext('table_alloc'));

  -- =========================================================================
  -- Selection, now the shared picker.
  -- =========================================================================
  IF NOT COALESCE(p_outside_seating, false) THEN
    SELECT c.table_ids, c.table_names
      INTO v_selected_table_ids, v_selected_table_names
      FROM public.find_table_allocation_candidates(
             v_booking_start, v_occupancy_end, p_party_size, v_purpose,
             COALESCE(p_high_chair_count, 0),
             COALESCE(p_requires_accessible_table, false),
             NULL,
             COALESCE(p_channel, 'online'),
             NULL,
             p_overrides,
             v_now
           ) c
     WHERE c.rank = 1;

    IF v_selected_table_ids IS NULL OR cardinality(v_selected_table_ids) = 0 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END IF;

    v_selected_table_id := v_selected_table_ids[1];
    v_selected_table_display_name := array_to_string(v_selected_table_names, ' + ');
  ELSE
    -- Outside: no indoor table, but a real cap, which v05 had none of.
    v_outside_count    := public.get_setting_int('outside_table_count', 5);
    v_outside_capacity := GREATEST(1, public.get_setting_int('outside_table_capacity', 8));
    v_outside_needed   := GREATEST(1, CEIL(p_party_size::numeric / v_outside_capacity)::integer);

    SELECT COALESCE(SUM(r.tables_reserved), 0)
      INTO v_outside_used
      FROM public.outside_reservations r
      JOIN public.table_bookings tb ON tb.id = r.table_booking_id
     WHERE public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, v_now)
       AND public.windows_overlap(r.starts_at, r.ends_at, v_booking_start, v_occupancy_end);

    IF v_outside_used + v_outside_needed > v_outside_count THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_full');
    END IF;
  END IF;

  -- =========================================================================
  -- Kitchen pacing. Arrivals, unchanged from v05.
  -- =========================================================================
  IF v_purpose = 'food' AND NOT COALESCE(p_bypass_pacing, false) THEN
    v_pacing_enabled := public.get_setting_bool('kitchen_pacing_enabled', false);

    IF v_pacing_enabled THEN
      v_pacing_window := public.get_setting_int('kitchen_pacing_window_minutes', 30);
      v_pace := public.get_setting_int(
        CASE WHEN v_is_sunday THEN 'kitchen_pace_covers_sunday' ELSE 'kitchen_pace_covers_regular' END,
        CASE WHEN v_is_sunday THEN 20 ELSE 25 END);
      v_reserve := public.get_setting_int(
        CASE WHEN v_is_sunday THEN 'kitchen_walk_in_reserve_sunday' ELSE 'kitchen_walk_in_reserve_regular' END, 6);

      SELECT sh.kitchen_pace_covers, sh.kitchen_walk_in_reserve
        INTO v_ovr_pace, v_ovr_reserve
        FROM public.special_hours sh WHERE sh.date = p_booking_date;

      v_pace    := COALESCE(v_ovr_pace, v_pace);
      v_reserve := COALESCE(v_ovr_reserve, v_reserve);
      v_ceiling := GREATEST(0, v_pace - v_reserve);

      v_center_minutes := EXTRACT(HOUR FROM p_booking_time)::int * 60 + EXTRACT(MINUTE FROM p_booking_time)::int;
      v_half := v_pacing_window / 2.0;

      SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0)
        INTO v_existing_covers
        FROM public.table_bookings tb
        WHERE tb.booking_date = p_booking_date
          AND COALESCE(tb.booking_purpose, 'food') = 'food'
          AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, v_now)
          AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) >= v_center_minutes - v_half
          AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) <  v_center_minutes + v_half;

      IF v_existing_covers + p_party_size > v_ceiling THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'slot_full');
      END IF;
    END IF;
  END IF;

  -- Drinks arrivals ceiling, which v05 had none of.
  IF v_purpose = 'drinks' AND NOT COALESCE(p_bypass_pacing, false) THEN
    v_pacing_window  := public.get_setting_int('kitchen_pacing_window_minutes', 30);
    v_center_minutes := EXTRACT(HOUR FROM p_booking_time)::int * 60 + EXTRACT(MINUTE FROM p_booking_time)::int;
    v_half := v_pacing_window / 2.0;

    SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0)
      INTO v_existing_covers
      FROM public.table_bookings tb
      WHERE tb.booking_date = p_booking_date
        AND COALESCE(tb.booking_purpose, 'food') = 'drinks'
        AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, v_now)
        AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) >= v_center_minutes - v_half
        AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) <  v_center_minutes + v_half;

    IF v_existing_covers + p_party_size > public.get_setting_int('drinks_arrivals_ceiling', 40) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'drinks_full');
    END IF;
  END IF;

  -- =========================================================================
  -- High chairs. Unchanged: never blocks, grants what is left.
  -- =========================================================================
  IF COALESCE(p_high_chair_count, 0) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('high_chair_reservation'));
    v_high_chair_inventory := public.get_setting_int('high_chair_inventory', 2);
    v_high_chairs_granted := GREATEST(
      0,
      LEAST(p_high_chair_count, v_high_chair_inventory - public.count_high_chairs_in_window(v_booking_start, v_occupancy_end, NULL))
    )::integer;
  ELSE
    v_high_chairs_granted := 0;
  END IF;

  -- =========================================================================
  -- THE DEPOSIT. One function decides money, and this is where it is asked.
  --
  -- What used to be here was "(p_party_size >= 10 OR v_is_christmas)" at a flat GBP 10 a head, and
  -- it never read booking_periods at all. A manager could create Mother's Day at GBP 15 a head,
  -- watch the settings screen preview "2 guests: GBP 30", and the guest would be charged nothing.
  -- Every per_booking period and every per-head rate other than GBP 10 was silently ignored, and
  -- so were min_party_size, max_party_size and the kill switch.
  --
  -- resolve_table_booking_deposit re-reads the period by id inside this transaction, applies the
  -- larger-of-two rule without ever stacking them, honours booking_period_deposits_enabled, and
  -- returns ONE amount. Its TypeScript mirror in src/lib/table-bookings/period-deposit.ts is what
  -- the settings preview and the website endpoint use, so all three now answer identically.
  --
  -- The period id is passed ONLY when the guest accepted. A guest who said "no, this is not a
  -- Christmas dinner" is booking the normal menu at normal terms, and must not be blocked by that
  -- period's party limits or by a festive menu nobody has published yet. Their answer is still
  -- snapshotted onto the booking below, because "they were asked and declined" is the fact a later
  -- dispute turns on. The id itself was already checked against the booking date above, so a stale
  -- or tampered one never reaches this call.
  -- =========================================================================
  v_deposit := public.resolve_table_booking_deposit(
    p_party_size,
    p_booking_date,
    CASE WHEN v_period_accepted THEN v_period_id ELSE NULL END,
    v_period_accepted,
    COALESCE(p_deposit_waived, false)
  );

  IF NOT COALESCE((v_deposit ->> 'ok')::boolean, false) THEN
    -- A party outside the period's limits, a menu that is not published, a stale id. Distinguishable
    -- rather than a silent zero, which is the whole reason the resolver returns codes.
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', COALESCE(v_deposit ->> 'error_code', 'deposit_unresolved'));
  END IF;

  v_deposit_required     := COALESCE((v_deposit ->> 'required')::boolean, false);
  v_deposit_rule         := v_deposit ->> 'rule';
  v_deposit_basis        := v_deposit ->> 'basis';
  v_deposit_rate         := NULLIF(v_deposit ->> 'rate', '')::numeric;
  v_deposit_refund_days  := NULLIF(v_deposit ->> 'refund_cutoff_days', '')::integer;
  v_deposit_refund_policy := v_deposit ->> 'refund_policy';

  IF v_deposit_required THEN
    v_booking_status := 'pending_payment'::public.table_booking_status;
    v_hold_expires_at := LEAST(v_booking_start, v_now + INTERVAL '24 hours');
    IF v_hold_expires_at <= v_now THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  ELSE
    v_booking_status := 'confirmed'::public.table_booking_status;
    v_hold_expires_at := NULL;
  END IF;

  IF COALESCE(p_sunday_lunch, false) THEN
    v_sunday_preorder_cutoff_at :=
      (((p_booking_date - INTERVAL '1 day')::date::text || ' 13:00')::timestamp AT TIME ZONE 'Europe/London');
  ELSE
    v_sunday_preorder_cutoff_at := NULL;
  END IF;

  v_booking_reference := 'TB-' || UPPER(SUBSTRING(MD5(CLOCK_TIMESTAMP()::text || RANDOM()::text) FROM 1 FOR 8));
  v_party_size_eff := GREATEST(1, p_party_size);
  -- Straight from the resolver. Never recomputed here, because a second copy of the sum is how the
  -- payments row and the booking row end up disagreeing about what the guest owes.
  v_deposit_amount := ROUND(COALESCE((v_deposit ->> 'amount')::numeric, 0), 2);

  INSERT INTO public.table_bookings (
    customer_id, booking_reference, booking_date, booking_time, booking_type, status,
    party_size, special_requirements, duration_minutes, source, confirmed_at, booking_purpose,
    committed_party_size, hold_expires_at, payment_method, payment_status,
    start_datetime, end_datetime, sunday_preorder_cutoff_at, deposit_waived,
    high_chair_count, is_outside_seating, requires_accessible_table,
    table_pinned, assignment_soft, created_at, updated_at,
    -- The terms snapshot. Written once, never recomputed. A manager renaming, repricing, shrinking
    -- or archiving a period must not change a booking already taken: if a guest disputes a charge
    -- six months later, this row alone has to answer which period, called what, did they say yes,
    -- on what basis, at what rate, for how much, and what was the refund promise.
    booking_period_id, booking_period_code, booking_period_name, booking_period_answer,
    booking_period_requires_preorder,
    deposit_rule, deposit_basis, deposit_rate, deposit_amount,
    deposit_refund_cutoff_days, deposit_refund_policy
  ) VALUES (
    p_customer_id, v_booking_reference, p_booking_date, p_booking_time, v_booking_type, v_booking_status,
    p_party_size, NULLIF(TRIM(COALESCE(p_notes, '')), ''), v_duration_minutes,
    COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'brand_site'),
    CASE WHEN v_booking_status = 'confirmed'::public.table_booking_status THEN v_now ELSE NULL END,
    v_purpose, p_party_size, v_hold_expires_at,
    CASE WHEN v_deposit_required THEN 'payment_link'::public.table_booking_payment_method ELSE NULL END,
    CASE WHEN v_deposit_required THEN 'pending'::public.payment_status ELSE NULL END,
    v_booking_start, v_booking_end, v_sunday_preorder_cutoff_at, p_deposit_waived,
    v_high_chairs_granted, COALESCE(p_outside_seating, false),
    COALESCE(p_requires_accessible_table, false),
    COALESCE(p_pin, false),
    -- Drinks bookings hold a table but yield it to a food booking that has nowhere else to go.
    (v_purpose = 'drinks' AND NOT COALESCE(p_outside_seating, false)),
    v_now, v_now,
    -- The period is recorded whenever one covered the date, and the ANSWER is recorded even when it
    -- was no, because "they were asked and declined" is exactly the fact a later dispute turns on.
    v_period_id,
    CASE WHEN v_period_id IS NOT NULL THEN v_period.code ELSE NULL END,
    CASE WHEN v_period_id IS NOT NULL THEN v_period.name ELSE NULL END,
    CASE WHEN v_period_id IS NOT NULL THEN v_period_accepted ELSE NULL END,
    CASE WHEN v_period_accepted THEN v_period.requires_preorder ELSE NULL END,
    v_deposit_rule, v_deposit_basis, v_deposit_rate,
    -- Only written when money is actually owed, so getCanonicalDeposit keeps behaving exactly as it
    -- does today for every booking that owes nothing.
    CASE WHEN v_deposit_required THEN v_deposit_amount ELSE NULL END,
    v_deposit_refund_days, v_deposit_refund_policy
  )
  RETURNING id INTO v_table_booking_id;

  IF NOT COALESCE(p_outside_seating, false) THEN
    INSERT INTO public.booking_table_assignments (
      table_booking_id, table_id, start_datetime, end_datetime, created_at
    )
    SELECT v_table_booking_id, selected_table_id, v_booking_start, v_occupancy_end, v_now
    FROM unnest(v_selected_table_ids) AS selected_table_id;
  ELSE
    INSERT INTO public.outside_reservations (
      table_booking_id, tables_reserved, capacity_basis, starts_at, ends_at
    ) VALUES (
      v_table_booking_id, v_outside_needed, v_outside_capacity, v_booking_start, v_occupancy_end
    );
  END IF;

  IF v_deposit_required THEN
    INSERT INTO public.booking_holds (
      hold_type, table_booking_id, seats_or_covers_held, status,
      scheduled_sms_send_time, expires_at, created_at, updated_at
    ) VALUES (
      'payment_hold', v_table_booking_id, p_party_size, 'active',
      v_now, v_hold_expires_at, v_now, v_now
    );

    INSERT INTO public.payments (
      table_booking_id, charge_type, amount, currency, status, metadata, created_at
    ) VALUES (
      v_table_booking_id, 'table_deposit', v_deposit_amount, 'GBP', 'pending',
      jsonb_build_object(
        'source', 'foh_booking_create',
        -- Which rule produced this charge, and at what rate. "deposit_per_person: 10" was hardcoded
        -- and became a lie the moment a period charged anything else.
        'deposit_rule', v_deposit_rule,
        'deposit_basis', v_deposit_basis,
        'deposit_rate', v_deposit_rate,
        'deposit_per_person', CASE WHEN v_deposit_basis = 'per_head' THEN v_deposit_rate ELSE NULL END,
        'booking_period_code', CASE WHEN v_period_accepted THEN v_period.code ELSE NULL END,
        'refund_cutoff_days', v_deposit_refund_days,
        'party_size', v_party_size_eff,
        'created_at', v_now
      ),
      v_now
    );
  END IF;

  -- Audit any override actually used, with the actor the trusted route supplied.
  IF p_overrides IS NOT NULL
     AND (COALESCE((p_overrides).ignore_minimum, false)
       OR COALESCE((p_overrides).ignore_hold, false)
       OR COALESCE((p_overrides).allow_unjoined, false)
       OR COALESCE((p_overrides).ignore_accessibility, false)) THEN
    INSERT INTO public.audit_logs
      (user_id, operation_type, resource_type, resource_id, operation_status, new_values)
    VALUES
      (p_actor_id, 'create', 'table_booking_override', v_table_booking_id::text, 'success',
       jsonb_build_object('channel', p_channel, 'overrides', to_jsonb(p_overrides)));
  END IF;

  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_booking_status = 'pending_payment'::public.table_booking_status THEN 'pending_payment'
      ELSE 'confirmed'
    END,
    'table_booking_id', v_table_booking_id,
    'booking_reference', v_booking_reference,
    'status', v_booking_status::text,
    'table_id', v_selected_table_id,
    'table_ids', to_jsonb(v_selected_table_ids),
    'table_name', v_selected_table_display_name,
    'table_names', to_jsonb(v_selected_table_names),
    'tables_joined', COALESCE(cardinality(v_selected_table_ids) > 1, false),
    'party_size', p_party_size,
    'booking_purpose', v_purpose,
    'booking_type', v_booking_type::text,
    'start_datetime', v_booking_start,
    'end_datetime', v_booking_end,
    'hold_expires_at', v_hold_expires_at,
    'sunday_lunch', COALESCE(p_sunday_lunch, false),
    'sunday_preorder_cutoff_at', v_sunday_preorder_cutoff_at,
    'high_chairs_granted', v_high_chairs_granted,
    'high_chair_count', v_high_chairs_granted,
    'high_chairs_short', GREATEST(0, COALESCE(p_high_chair_count, 0) - v_high_chairs_granted),
    'is_outside_seating', COALESCE(p_outside_seating, false),
    'requires_accessible_table', COALESCE(p_requires_accessible_table, false),
    -- So the caller can show the guest the figure that was actually charged and the promise that
    -- came with it, rather than recomputing either.
    'deposit_required', v_deposit_required,
    'deposit_amount', CASE WHEN v_deposit_required THEN v_deposit_amount ELSE 0 END,
    'deposit_rule', v_deposit_rule,
    -- The basis and rate that produced the amount, so analytics and staff screens can report the
    -- real rate instead of assuming every deposit is the large-group one at GBP 10 a head.
    'deposit_basis', v_deposit_basis,
    'deposit_rate', v_deposit_rate,
    'deposit_reason', v_deposit ->> 'reason',
    'deposit_refund_cutoff_days', v_deposit_refund_days,
    'deposit_refund_policy', v_deposit_refund_policy,
    'booking_period_id', v_period_id,
    'booking_period_code', CASE WHEN v_period_id IS NOT NULL THEN v_period.code ELSE NULL END,
    'booking_period_name', CASE WHEN v_period_id IS NOT NULL THEN v_period.name ELSE NULL END,
    'booking_period_answer', CASE WHEN v_period_id IS NOT NULL THEN v_period_accepted ELSE NULL END,
    'booking_period_requires_preorder',
      CASE WHEN v_period_accepted THEN v_period.requires_preorder ELSE NULL END
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. create_table_booking_v05. Production text; only the Christmas minimum and its
--    message differ.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text DEFAULT 'food'::text, p_notes text DEFAULT NULL::text, p_sunday_lunch boolean DEFAULT false, p_source text DEFAULT 'brand_site'::text, p_bypass_cutoff boolean DEFAULT false, p_deposit_waived boolean DEFAULT false, p_bypass_pacing boolean DEFAULT false, p_high_chair_count integer DEFAULT 0, p_outside_seating boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purpose text;
  v_is_christmas boolean := false;
  v_booking_type public.table_booking_type;
  v_booking_status public.table_booking_status;
  v_is_sunday boolean;

  v_booking_start_local timestamp without time zone;
  v_booking_start timestamptz;
  v_booking_end timestamptz;

  v_hours_row RECORD;

  v_pub_open_minutes integer;
  v_pub_close_minutes integer;
  v_pub_close_service_minutes integer;
  v_pub_booking_minutes integer;

  v_kitchen_open_minutes integer;
  v_kitchen_close_minutes integer;
  v_kitchen_close_service_minutes integer;
  v_kitchen_booking_minutes integer;

  v_food_duration_minutes integer := 120;
  v_drinks_duration_minutes integer := 90;
  v_sunday_duration_minutes integer := 120;
  v_duration_minutes integer;

  v_drinks_near_close_allowed boolean := false;

  v_selected_table_id uuid;
  v_selected_table_ids uuid[];
  v_selected_table_names text[];
  v_selected_table_display_name text;

  v_table_booking_id uuid;
  v_booking_reference text;

  v_deposit_required boolean := false;
  v_hold_expires_at timestamptz;
  v_now timestamptz := NOW();
  v_party_size_eff integer;
  v_deposit_amount numeric(10, 2);
  v_payment_id uuid;

  v_sunday_preorder_cutoff_at timestamptz;

  v_pacing_enabled boolean;
  v_pacing_window integer;
  v_pace_base integer;
  v_reserve_base integer;
  v_ovr_pace integer;
  v_ovr_reserve integer;
  v_pace integer;
  v_reserve integer;
  v_ceiling integer;
  v_center_minutes integer;
  v_half numeric;
  v_existing_covers integer;

  v_high_chair_inventory integer;
  v_high_chairs_granted integer := 0;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_customer');
  END IF;

  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_datetime');
  END IF;

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_party_size');
  END IF;

  IF p_party_size >= 21 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  v_purpose := LOWER(TRIM(COALESCE(p_booking_purpose, 'food')));
  v_is_christmas := (v_purpose = 'christmas');
  IF v_is_christmas THEN
    v_purpose := 'food';
    IF p_party_size < 4 THEN
      RAISE EXCEPTION 'Christmas bookings are for 4 guests or more.' USING ERRCODE = '22023';
    END IF;
    IF p_party_size > 20 THEN
      RAISE EXCEPTION 'Christmas bookings for more than 20 guests are arranged as private hire. Please contact manager@the-anchor.pub, 01753 682707, or WhatsApp 01753 682707.' USING ERRCODE = '22023';
    END IF;
    IF NOT COALESCE(p_bypass_cutoff, false)
       AND (p_booking_date + p_booking_time) < ((NOW() AT TIME ZONE 'Europe/London') + INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Christmas bookings need at least 24 hours notice.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_purpose NOT IN ('food', 'drinks') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_purpose');
  END IF;

  v_is_sunday := EXTRACT(DOW FROM p_booking_date)::integer = 0;
  IF COALESCE(p_sunday_lunch, false) AND NOT v_is_sunday THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'sunday_lunch_requires_sunday');
  END IF;

  v_booking_type := CASE
    WHEN v_is_christmas THEN 'christmas'::public.table_booking_type
    WHEN COALESCE(p_sunday_lunch, false) THEN 'sunday_lunch'::public.table_booking_type
    ELSE 'regular'::public.table_booking_type
  END;

  v_booking_start_local := (p_booking_date::text || ' ' || p_booking_time::text)::timestamp;
  v_booking_start := v_booking_start_local AT TIME ZONE 'Europe/London';

  IF v_booking_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'in_past');
  END IF;

  SELECT
    bh.day_of_week,
    COALESCE(sh.is_closed, bh.is_closed, false) AS is_closed,
    COALESCE(sh.is_kitchen_closed, bh.is_kitchen_closed, false) AS is_kitchen_closed,
    COALESCE(sh.opens, bh.opens) AS opens,
    COALESCE(sh.closes, bh.closes) AS closes,
    COALESCE(sh.kitchen_opens, bh.kitchen_opens) AS kitchen_opens,
    COALESCE(sh.kitchen_closes, bh.kitchen_closes) AS kitchen_closes
  INTO v_hours_row
  FROM public.business_hours_for_date(p_booking_date) bh
  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  IF COALESCE(v_hours_row.is_closed, false) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  IF v_hours_row.opens IS NULL OR v_hours_row.closes IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  v_pub_open_minutes := (EXTRACT(HOUR FROM v_hours_row.opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.opens)::integer;
  v_pub_close_minutes := (EXTRACT(HOUR FROM v_hours_row.closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.closes)::integer;
  v_pub_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;

  v_pub_close_service_minutes := CASE
    WHEN v_pub_close_minutes <= v_pub_open_minutes THEN v_pub_close_minutes + 1440
    ELSE v_pub_close_minutes
  END;

  IF v_pub_close_minutes <= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_open_minutes THEN
    v_pub_booking_minutes := v_pub_booking_minutes + 1440;
  END IF;

  IF NOT (v_pub_booking_minutes >= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_close_service_minutes) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  SELECT
    COALESCE(
      CASE
        WHEN jsonb_typeof(value) = 'boolean' THEN (value::text)::boolean
        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::numeric <> 0
        WHEN jsonb_typeof(value) = 'string' THEN LOWER(TRIM(BOTH '"' FROM value::text)) IN ('1','true','yes','y','on')
        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
          LOWER(value->>'enabled') IN ('1','true','yes','y','on'),
          LOWER(value->>'allow') IN ('1','true','yes','y','on')
        )
        ELSE NULL
      END,
      false
    )
  INTO v_drinks_near_close_allowed
  FROM public.system_settings
  WHERE key IN (
    'table_booking_drinks_near_close_allowed',
    'table_bookings_drinks_near_close_allowed',
    'drinks_near_close_allowed'
  )
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_purpose = 'food' OR COALESCE(p_sunday_lunch, false) THEN
    IF COALESCE(v_hours_row.is_kitchen_closed, false)
       OR v_hours_row.kitchen_opens IS NULL
       OR v_hours_row.kitchen_closes IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
    END IF;

    v_kitchen_open_minutes := (EXTRACT(HOUR FROM v_hours_row.kitchen_opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.kitchen_opens)::integer;
    v_kitchen_close_minutes := (EXTRACT(HOUR FROM v_hours_row.kitchen_closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.kitchen_closes)::integer;
    v_kitchen_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;

    v_kitchen_close_service_minutes := CASE
      WHEN v_kitchen_close_minutes <= v_kitchen_open_minutes THEN v_kitchen_close_minutes + 1440
      ELSE v_kitchen_close_minutes
    END;

    IF v_kitchen_close_minutes <= v_kitchen_open_minutes AND v_kitchen_booking_minutes < v_kitchen_open_minutes THEN
      v_kitchen_booking_minutes := v_kitchen_booking_minutes + 1440;
    END IF;

    IF NOT (v_kitchen_booking_minutes >= v_kitchen_open_minutes AND v_kitchen_booking_minutes < v_kitchen_close_service_minutes) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
    END IF;

    IF v_kitchen_booking_minutes > (v_kitchen_close_service_minutes - 30)
       AND NOT COALESCE(p_bypass_cutoff, false) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  END IF;

  IF v_purpose = 'drinks' AND NOT COALESCE(v_drinks_near_close_allowed, false)
     AND NOT COALESCE(p_bypass_cutoff, false) THEN
    IF v_pub_booking_minutes > (v_pub_close_service_minutes - 30) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  END IF;

  SELECT
    COALESCE(
      CASE
        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::integer
        WHEN jsonb_typeof(value) = 'string' THEN NULLIF(regexp_replace(TRIM(BOTH '"' FROM value::text), '[^0-9]', '', 'g'), '')::integer
        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
          NULLIF(regexp_replace(COALESCE(value->>'minutes', ''), '[^0-9]', '', 'g'), '')::integer,
          NULLIF(regexp_replace(COALESCE(value->>'value', ''), '[^0-9]', '', 'g'), '')::integer
        )
        ELSE NULL
      END,
      120
    )
  INTO v_food_duration_minutes
  FROM public.system_settings
  WHERE key IN ('table_booking_duration_food_minutes', 'table_bookings_food_duration_minutes')
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT
    COALESCE(
      CASE
        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::integer
        WHEN jsonb_typeof(value) = 'string' THEN NULLIF(regexp_replace(TRIM(BOTH '"' FROM value::text), '[^0-9]', '', 'g'), '')::integer
        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
          NULLIF(regexp_replace(COALESCE(value->>'minutes', ''), '[^0-9]', '', 'g'), '')::integer,
          NULLIF(regexp_replace(COALESCE(value->>'value', ''), '[^0-9]', '', 'g'), '')::integer
        )
        ELSE NULL
      END,
      90
    )
  INTO v_drinks_duration_minutes
  FROM public.system_settings
  WHERE key IN ('table_booking_duration_drinks_minutes', 'table_bookings_drinks_duration_minutes')
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT
    COALESCE(
      CASE
        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::integer
        WHEN jsonb_typeof(value) = 'string' THEN NULLIF(regexp_replace(TRIM(BOTH '"' FROM value::text), '[^0-9]', '', 'g'), '')::integer
        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
          NULLIF(regexp_replace(COALESCE(value->>'minutes', ''), '[^0-9]', '', 'g'), '')::integer,
          NULLIF(regexp_replace(COALESCE(value->>'value', ''), '[^0-9]', '', 'g'), '')::integer
        )
        ELSE NULL
      END,
      120
    )
  INTO v_sunday_duration_minutes
  FROM public.system_settings
  WHERE key IN (
    'table_booking_duration_sunday_lunch_minutes',
    'table_bookings_sunday_lunch_duration_minutes'
  )
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  v_duration_minutes := CASE
    WHEN COALESCE(p_sunday_lunch, false) THEN GREATEST(30, COALESCE(v_sunday_duration_minutes, 120))
    WHEN v_purpose = 'food' THEN GREATEST(30, COALESCE(v_food_duration_minutes, 120))
    ELSE GREATEST(30, COALESCE(v_drinks_duration_minutes, 90))
  END;

  v_booking_end := v_booking_start + make_interval(mins => v_duration_minutes);

  IF NOT COALESCE(p_outside_seating, false) THEN
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS display_name
    INTO v_selected_table_id, v_selected_table_display_name
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) = true
      AND t.capacity >= p_party_size
      AND NOT EXISTS (
        SELECT 1
        FROM public.booking_table_assignments bta
        JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
        WHERE bta.table_id = t.id
          AND tb.status NOT IN ('cancelled', 'no_show')
          AND (tb.left_at IS NULL)
          AND bta.start_datetime < v_booking_end
          AND bta.end_datetime > v_booking_start
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_communal_seat_allocations ecsa
        JOIN public.bookings b ON b.id = ecsa.event_booking_id
        WHERE ecsa.table_id = t.id
          AND ecsa.start_datetime < v_booking_end
          AND ecsa.end_datetime > v_booking_start
          AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
      )
    ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
    LIMIT 1;

    IF v_selected_table_id IS NOT NULL THEN
      v_selected_table_ids := ARRAY[v_selected_table_id];
      v_selected_table_names := ARRAY[v_selected_table_display_name];
    ELSE
      WITH RECURSIVE available_tables AS (
        SELECT
          t.id,
          COALESCE(t.name, t.table_number) AS display_name,
          COALESCE(t.capacity, 0)::integer AS capacity
        FROM public.tables t
        WHERE COALESCE(t.is_bookable, true) = true
          AND COALESCE(t.capacity, 0) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM public.booking_table_assignments bta
            JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
            WHERE bta.table_id = t.id
              AND tb.status NOT IN ('cancelled', 'no_show')
              AND (tb.left_at IS NULL)
              AND bta.start_datetime < v_booking_end
              AND bta.end_datetime > v_booking_start
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.event_communal_seat_allocations ecsa
            JOIN public.bookings b ON b.id = ecsa.event_booking_id
            WHERE ecsa.table_id = t.id
              AND ecsa.start_datetime < v_booking_end
              AND ecsa.end_datetime > v_booking_start
              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          )
      ),
      links AS (
        SELECT l.table_id, l.join_table_id
        FROM public.table_join_links l
      ),
      combos AS (
        SELECT
          ARRAY[a.id]::uuid[] AS table_ids,
          ARRAY[a.display_name]::text[] AS table_names,
          a.capacity::integer AS total_capacity,
          a.id AS last_table_id
        FROM available_tables a

        UNION ALL

        SELECT
          c.table_ids || a.id,
          c.table_names || a.display_name,
          c.total_capacity + a.capacity,
          a.id AS last_table_id
        FROM combos c
        JOIN available_tables a
          ON a.id > c.last_table_id
        WHERE cardinality(c.table_ids) < 8
          AND EXISTS (
            SELECT 1
            FROM unnest(c.table_ids) existing(table_id)
            JOIN links l
              ON (l.table_id = existing.table_id AND l.join_table_id = a.id)
              OR (l.join_table_id = existing.table_id AND l.table_id = a.id)
          )
      )
      SELECT
        c.table_ids,
        c.table_names
      INTO v_selected_table_ids, v_selected_table_names
      FROM combos c
      WHERE cardinality(c.table_ids) >= 2
        AND c.total_capacity >= p_party_size
      ORDER BY cardinality(c.table_ids) ASC, c.total_capacity ASC, c.table_names
      LIMIT 1;

      IF v_selected_table_ids IS NOT NULL AND cardinality(v_selected_table_ids) > 0 THEN
        v_selected_table_id := v_selected_table_ids[1];
        v_selected_table_display_name := array_to_string(v_selected_table_names, ' + ');
      END IF;
    END IF;

    IF v_selected_table_ids IS NULL OR cardinality(v_selected_table_ids) = 0 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END IF;
  END IF;

  IF v_purpose = 'food' AND NOT COALESCE(p_bypass_pacing, false) THEN
    SELECT COALESCE((value ->> 'value')::boolean, false)
      INTO v_pacing_enabled
      FROM public.system_settings WHERE key = 'kitchen_pacing_enabled';

    IF COALESCE(v_pacing_enabled, false) THEN
      SELECT COALESCE((value ->> 'value')::int, 30) INTO v_pacing_window
        FROM public.system_settings WHERE key = 'kitchen_pacing_window_minutes';
      v_pacing_window := COALESCE(v_pacing_window, 30);

      SELECT COALESCE((value ->> 'value')::int, CASE WHEN v_is_sunday THEN 20 ELSE 25 END)
        INTO v_pace_base
        FROM public.system_settings
        WHERE key = CASE WHEN v_is_sunday THEN 'kitchen_pace_covers_sunday' ELSE 'kitchen_pace_covers_regular' END;
      v_pace_base := COALESCE(v_pace_base, CASE WHEN v_is_sunday THEN 20 ELSE 25 END);

      SELECT COALESCE((value ->> 'value')::int, 6)
        INTO v_reserve_base
        FROM public.system_settings
        WHERE key = CASE WHEN v_is_sunday THEN 'kitchen_walk_in_reserve_sunday' ELSE 'kitchen_walk_in_reserve_regular' END;
      v_reserve_base := COALESCE(v_reserve_base, 6);

      SELECT sh.kitchen_pace_covers, sh.kitchen_walk_in_reserve
        INTO v_ovr_pace, v_ovr_reserve
        FROM public.special_hours sh WHERE sh.date = p_booking_date;

      v_pace := COALESCE(v_ovr_pace, v_pace_base);
      v_reserve := COALESCE(v_ovr_reserve, v_reserve_base);
      v_ceiling := GREATEST(0, v_pace - v_reserve);

      v_center_minutes := EXTRACT(HOUR FROM p_booking_time)::int * 60 + EXTRACT(MINUTE FROM p_booking_time)::int;
      v_half := v_pacing_window / 2.0;

      PERFORM pg_advisory_xact_lock(('x' || substr(md5('kitchen_pacing:' || p_booking_date::text), 1, 16))::bit(64)::bigint);

      SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0)
        INTO v_existing_covers
        FROM public.table_bookings tb
        WHERE tb.booking_date = p_booking_date
          AND COALESCE(tb.booking_purpose, 'food') = 'food'
          AND tb.status NOT IN ('cancelled', 'no_show')
          AND tb.left_at IS NULL
          AND NOT (
            tb.status IN ('pending_payment', 'pending_card_capture')
            AND tb.hold_expires_at IS NOT NULL
            AND tb.payment_status IS DISTINCT FROM 'completed'
            AND tb.hold_expires_at < v_now
          )
          AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) >= v_center_minutes - v_half
          AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) <  v_center_minutes + v_half;

      IF v_existing_covers + p_party_size > v_ceiling THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'slot_full');
      END IF;
    END IF;
  END IF;

  IF COALESCE(p_high_chair_count, 0) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('high_chair_reservation'));
    SELECT COALESCE((value ->> 'value')::int, 2) INTO v_high_chair_inventory
      FROM public.system_settings WHERE key = 'high_chair_inventory';
    v_high_chair_inventory := COALESCE(v_high_chair_inventory, 2);
    v_high_chairs_granted := GREATEST(
      0,
      LEAST(p_high_chair_count, v_high_chair_inventory - public.count_high_chairs_in_window(v_booking_start, v_booking_end, NULL))
    )::integer;
  ELSE
    v_high_chairs_granted := 0;
  END IF;

  v_deposit_required := (p_party_size >= 10 OR v_is_christmas) AND NOT COALESCE(p_deposit_waived, false);

  IF p_deposit_waived THEN
    v_deposit_required := false;
  END IF;

  IF v_deposit_required THEN
    v_booking_status := 'pending_payment'::public.table_booking_status;
    v_hold_expires_at := LEAST(v_booking_start, v_now + INTERVAL '24 hours');

    IF v_hold_expires_at <= v_now THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  ELSE
    v_booking_status := 'confirmed'::public.table_booking_status;
    v_hold_expires_at := NULL;
  END IF;

  IF COALESCE(p_sunday_lunch, false) THEN
    v_sunday_preorder_cutoff_at :=
      (((p_booking_date - INTERVAL '1 day')::date::text || ' 13:00')::timestamp AT TIME ZONE 'Europe/London');
  ELSE
    v_sunday_preorder_cutoff_at := NULL;
  END IF;

  v_booking_reference :=
    'TB-' || UPPER(SUBSTRING(MD5(CLOCK_TIMESTAMP()::text || RANDOM()::text) FROM 1 FOR 8));

  v_party_size_eff := GREATEST(1, p_party_size);
  v_deposit_amount := ROUND((v_party_size_eff::numeric) * 10.0, 2);

  INSERT INTO public.table_bookings (
    customer_id,
    booking_reference,
    booking_date,
    booking_time,
    booking_type,
    status,
    party_size,
    special_requirements,
    duration_minutes,
    source,
    confirmed_at,
    booking_purpose,
    committed_party_size,
    hold_expires_at,
    payment_method,
    payment_status,
    start_datetime,
    end_datetime,
    sunday_preorder_cutoff_at,
    deposit_waived,
    high_chair_count,
    is_outside_seating,
    created_at,
    updated_at
  ) VALUES (
    p_customer_id,
    v_booking_reference,
    p_booking_date,
    p_booking_time,
    v_booking_type,
    v_booking_status,
    p_party_size,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    v_duration_minutes,
    COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'brand_site'),
    CASE WHEN v_booking_status = 'confirmed'::public.table_booking_status THEN v_now ELSE NULL END,
    v_purpose,
    p_party_size,
    v_hold_expires_at,
    CASE WHEN v_deposit_required THEN 'payment_link'::public.table_booking_payment_method ELSE NULL END,
    CASE WHEN v_deposit_required THEN 'pending'::public.payment_status ELSE NULL END,
    v_booking_start,
    v_booking_end,
    v_sunday_preorder_cutoff_at,
    p_deposit_waived,
    v_high_chairs_granted,
    COALESCE(p_outside_seating, false),
    v_now,
    v_now
  )
  RETURNING id INTO v_table_booking_id;

  IF NOT COALESCE(p_outside_seating, false) THEN
    INSERT INTO public.booking_table_assignments (
      table_booking_id,
      table_id,
      start_datetime,
      end_datetime,
      created_at
    )
    SELECT
      v_table_booking_id,
      selected_table_id,
      v_booking_start,
      v_booking_end,
      v_now
    FROM unnest(v_selected_table_ids) AS selected_table_id;
  END IF;

  IF v_deposit_required THEN
    INSERT INTO public.booking_holds (
      hold_type,
      table_booking_id,
      seats_or_covers_held,
      status,
      scheduled_sms_send_time,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_table_booking_id,
      p_party_size,
      'active',
      v_now,
      v_hold_expires_at,
      v_now,
      v_now
    );

    INSERT INTO public.payments (
      table_booking_id,
      charge_type,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      v_table_booking_id,
      'table_deposit',
      v_deposit_amount,
      'GBP',
      'pending',
      jsonb_build_object(
        'source', 'foh_booking_create',
        'deposit_per_person', 10,
        'party_size', v_party_size_eff,
        'created_at', v_now
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_booking_status = 'pending_payment'::public.table_booking_status THEN 'pending_payment'
      ELSE 'confirmed'
    END,
    'table_booking_id', v_table_booking_id,
    'booking_reference', v_booking_reference,
    'status', v_booking_status::text,
    'table_id', v_selected_table_id,
    'table_ids', to_jsonb(v_selected_table_ids),
    'table_name', v_selected_table_display_name,
    'table_names', to_jsonb(v_selected_table_names),
    'tables_joined', cardinality(v_selected_table_ids) > 1,
    'party_size', p_party_size,
    'booking_purpose', v_purpose,
    'booking_type', v_booking_type::text,
    'start_datetime', v_booking_start,
    'end_datetime', v_booking_end,
    'hold_expires_at', v_hold_expires_at,
    'sunday_lunch', COALESCE(p_sunday_lunch, false),
    'sunday_preorder_cutoff_at', v_sunday_preorder_cutoff_at,
    'high_chairs_granted', v_high_chairs_granted,
    'high_chair_count', v_high_chairs_granted,
    'is_outside_seating', COALESCE(p_outside_seating, false)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. EXECUTE, exactly as production holds it today.
--
-- Checked 11 September 2026:
--   create_table_booking_core_v06  postgres and service_role only
--   create_table_booking_v05       postgres, authenticated and service_role
-- CREATE OR REPLACE keeps an existing ACL, and the trg_lock_down_new_definer_routines event
-- trigger strips only PUBLIC and anon, which hold nothing here, so against production these four
-- statements change nothing. They are here so the end state is stated rather than inherited, and
-- so a rebuilt database comes out the same.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. DATA CHANGE, kept apart from the function changes above.
--
-- One row: the christmas-2026 booking period, id 8a4535ee-9547-4672-b20a-489457b46376 in
-- production. It is matched on code, the table's unique key, because the id is generated per
-- database and a rebuilt one seeds a different id. It only moves 6 to 4. If the figure is already
-- 4 this does nothing. If it is anything else, someone has changed it in Settings since
-- 11 September: the row is left alone and section 5 stops the migration, because the approval no
-- longer describes the data. booking_periods_touch_updated_at stamps updated_at; nothing else on
-- the row changes.
-- ---------------------------------------------------------------------------

UPDATE public.booking_periods
   SET min_party_size = 4
 WHERE code = 'christmas-2026'
   AND min_party_size = 6;

-- ---------------------------------------------------------------------------
-- 5. Prove the end state, or roll the whole migration back.
-- ---------------------------------------------------------------------------

DO $assert_christmas_minimum$
DECLARE
  v_core constant regprocedure :=
    'public.create_table_booking_core_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, text, boolean, integer, public.table_allocation_overrides, uuid, uuid, boolean)'::regprocedure;
  v_v05 constant regprocedure :=
    'public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean)'::regprocedure;
  v_fn regprocedure;
  v_src text;
  v_stale text;
  v_rows integer;
  v_min integer;
  v_problems text[] := ARRAY[]::text[];
BEGIN
  -- Both entry points refuse below 4, and say so in the words staff are shown.
  FOREACH v_fn IN ARRAY ARRAY[v_core, v_v05] LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_fn;
    IF position('IF p_party_size < 4 THEN' IN v_src) = 0
       OR position('''Christmas bookings are for 4 guests or more.''' IN v_src) = 0 THEN
      v_problems := v_problems || format('%s does not refuse Christmas parties under 4', v_fn);
    END IF;
  END LOOP;

  -- No routine in public still carries the other minimum, overloads included.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_stale
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc LIKE '%Christmas bookings are for 6 guests or more.%';
  IF v_stale IS NOT NULL THEN
    v_problems := v_problems || format('still refusing Christmas parties under 6: %s', v_stale);
  END IF;

  -- EXECUTE, asked of Postgres rather than read from the ACL text. A NULL proacl means the
  -- built-in default, EXECUTE to PUBLIC, which a regex over the ACL would report as closed.
  IF has_function_privilege('anon', v_core, 'EXECUTE')
     OR has_function_privilege('authenticated', v_core, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_core, 'EXECUTE') THEN
    v_problems := v_problems || 'create_table_booking_core_v06 EXECUTE is not service_role only'::text;
  END IF;
  IF has_function_privilege('anon', v_v05, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_v05, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_v05, 'EXECUTE') THEN
    v_problems := v_problems || 'create_table_booking_v05 EXECUTE is not authenticated and service_role only'::text;
  END IF;

  -- The data change landed.
  SELECT count(*), min(bp.min_party_size) INTO v_rows, v_min
    FROM public.booking_periods bp WHERE bp.code = 'christmas-2026';
  IF v_rows <> 1 OR v_min IS DISTINCT FROM 4 THEN
    v_problems := v_problems || format(
      'christmas-2026 booking period: %s row(s), min_party_size %s, expected 1 row at 4',
      v_rows, COALESCE(v_min::text, 'null'));
  END IF;

  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Christmas minimum not at 4: ' || array_to_string(v_problems, '; '),
      HINT = 'The whole migration rolls back, so nothing has changed.';
  END IF;
END
$assert_christmas_minimum$;

COMMIT;
