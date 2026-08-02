-- The seasonal deposit reaches the code that actually charges money.
--
-- WHAT WAS WRONG
--
-- 20260803000100 built seasonal booking periods: the table, the guards, the settings screen, a
-- deposit resolver in SQL and its tested TypeScript mirror, and a read endpoint for the website.
-- None of it was connected to the booking-creation path. resolve_table_booking_deposit had no
-- callers at all. Both create RPCs still ran this, unchanged since v05:
--
--     v_deposit_required := (p_party_size >= 10 OR v_is_christmas) ...
--     v_deposit_amount   := party_size * 10.0
--
-- and never read booking_periods. So: a manager creates "Mother's Day 2027", 14 March, GBP 15 per
-- head, and switches it on. The settings screen previews "2 guests: GBP 30 (this period)". A guest
-- books two covers that day and is charged NOTHING. Every per_booking period and every per-head
-- rate other than GBP 10 was silently ignored, and so were min_party_size, max_party_size,
-- min_notice_hours, requires_preorder, legacy_booking_type and the kill switch.
--
-- Nothing failed. No error appeared anywhere. The settings screen went on describing a deposit the
-- booking path had never heard of.
--
-- WHAT THIS DOES
--
--   1. Both create RPCs resolve the deposit through resolve_table_booking_deposit, inside their own
--      transaction, from the period re-read by booking date. The client's booking_period_id is
--      checked against that and refused when it disagrees; the client's ANSWER is the only thing
--      taken on trust, and a "yes" to an offer that is not running is refused too.
--   2. The terms are SNAPSHOT onto the booking: period id, code, name, the guest's answer, whether
--      it needed a pre-order, the rule that won, the basis, the rate, the amount and the refund
--      promise in words. Editing or archiving the period afterwards cannot alter any of it.
--   3. booking_period_deposits_enabled genuinely stops collection, because the resolver reads it
--      itself rather than trusting each caller to remember. The party-size rule is unaffected.
--   4. min_notice_hours comes from the period. Christmas keeps its 24 hours and, importantly, its
--      wording: both create routes pass a message beginning "Christmas bookings " straight through
--      to whoever typed the booking, so that prefix is load-bearing.
--
-- THE GBP 120 TIE, at the layer that charges. Christmas is seeded at GBP 10 per head and the
-- party-size rule is GBP 10 per head, so a party of 12 inside Christmas produces 120 by both
-- routes. Stacking them would charge 240 and would look right in every other test, because every
-- other number would still be correct. The resolver takes the LARGER, never the sum, and a tie goes
-- to the period so the guest-facing wording names the season. That was already asserted in the
-- TypeScript mirror, in the resolver's own tests and at the website endpoint. It is now asserted
-- here too, against the create path, which is the only one of the four that takes anyone's money.
--
-- WHY THE FUNCTIONS ARE DROPPED FIRST. Adding two defaulted parameters creates an OVERLOAD rather
-- than replacing the function, and a 14-argument call would then be ambiguous between the old
-- 14-parameter function and the new 16-parameter one, failing with "function is not unique" on
-- every booking. The old signatures are dropped in the same transaction. Named-argument callers,
-- which is all of them, are unaffected.
--
-- NOT APPLIED. Written and checked, not run. 20260802000008 is the latest migration in production.

BEGIN;

-- ---------------------------------------------------------------------------
-- Drop the old signatures. See the note above: this is a signature change, not
-- a replacement, so CREATE OR REPLACE would leave two ambiguous overloads.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean);

DROP FUNCTION IF EXISTS public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid);

DROP FUNCTION IF EXISTS public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid);

-- ---------------------------------------------------------------------------
-- The shared core. Not granted to anyone: reachable only through the two
-- entry points below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_table_booking_core_v06(
  p_customer_id               uuid,
  p_booking_date              date,
  p_booking_time              time without time zone,
  p_party_size                integer,
  p_booking_purpose           text,
  p_notes                     text,
  p_sunday_lunch              boolean,
  p_source                    text,
  p_bypass_cutoff             boolean,
  p_deposit_waived            boolean,
  p_bypass_pacing             boolean,
  p_high_chair_count          integer,
  p_outside_seating           boolean,
  p_requires_accessible_table boolean,
  p_channel                   text,
  p_pin                       boolean,
  p_max_party_size            integer,
  p_overrides                 public.table_allocation_overrides,
  p_actor_id                  uuid,
  -- NEW. Both are advisory: the period that actually applies is re-read from the booking date
  -- below, and a supplied id that does not match it is refused rather than trusted.
  p_booking_period_id         uuid,
  p_booking_period_answer     boolean
)
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
    IF p_party_size < 6 THEN
      RAISE EXCEPTION 'Christmas bookings are for 6 guests or more.' USING ERRCODE = '22023';
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
  FROM public.business_hours bh
  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
  WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer
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

CREATE OR REPLACE FUNCTION public.create_table_booking_public_v06(
  p_customer_id      uuid,
  p_booking_date     date,
  p_booking_time     time without time zone,
  p_party_size       integer,
  p_booking_purpose  text DEFAULT 'food'::text,
  p_notes            text DEFAULT NULL::text,
  p_sunday_lunch     boolean DEFAULT false,
  p_source           text DEFAULT 'brand_site'::text,
  p_bypass_cutoff    boolean DEFAULT false,
  p_deposit_waived   boolean DEFAULT false,
  p_bypass_pacing    boolean DEFAULT false,
  p_high_chair_count integer DEFAULT 0,
  p_outside_seating  boolean DEFAULT false,
  p_requires_accessible_table boolean DEFAULT false,
  -- Defaulted, so every existing caller compiles and behaves exactly as before.
  p_booking_period_id uuid DEFAULT NULL,
  p_booking_period_answer boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, p_booking_purpose,
    p_notes, p_sunday_lunch, p_source,
    -- A public caller cannot bypass the cut-off or pacing, whatever it passes.
    false, p_deposit_waived, false,
    p_high_chair_count, p_outside_seating, p_requires_accessible_table,
    'online', false,
    public.get_setting_int('table_booking_max_party_online', 20),
    NULL, NULL,
    p_booking_period_id, p_booking_period_answer
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_table_booking_staff_v06(
  p_customer_id      uuid,
  p_booking_date     date,
  p_booking_time     time without time zone,
  p_party_size       integer,
  p_booking_purpose  text DEFAULT 'food'::text,
  p_notes            text DEFAULT NULL::text,
  p_sunday_lunch     boolean DEFAULT false,
  p_source           text DEFAULT 'admin'::text,
  p_bypass_cutoff    boolean DEFAULT false,
  p_deposit_waived   boolean DEFAULT false,
  p_bypass_pacing    boolean DEFAULT false,
  p_high_chair_count integer DEFAULT 0,
  p_outside_seating  boolean DEFAULT false,
  p_requires_accessible_table boolean DEFAULT false,
  p_channel          text DEFAULT 'staff',
  p_pin              boolean DEFAULT false,
  p_overrides        public.table_allocation_overrides DEFAULT NULL,
  p_actor_id         uuid DEFAULT NULL,
  p_booking_period_id uuid DEFAULT NULL,
  p_booking_period_answer boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, p_booking_purpose,
    p_notes, p_sunday_lunch, p_source, p_bypass_cutoff, p_deposit_waived, p_bypass_pacing,
    p_high_chair_count, p_outside_seating, p_requires_accessible_table,
    COALESCE(NULLIF(p_channel, 'online'), 'staff'),   -- staff entry cannot masquerade as online
    p_pin,
    public.get_setting_int('table_booking_max_party_staff', 40),
    p_overrides, p_actor_id,
    p_booking_period_id, p_booking_period_answer
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- The refund promise, made immutable.
--
-- The snapshot is already safe from period edits by construction: the booking carries copies and
-- nothing ever joins back to booking_periods or recomputes from it. This closes the remaining way
-- it could move, which is somebody writing to the booking directly, whether by a support script, a
-- future bulk update, or a well-meant "tidy up the old bookings" migration.
--
-- Only the refund TERMS are frozen, not the whole snapshot. The rest describes the charge and may
-- legitimately be corrected: a manager waiving a deposit after the fact, or a party-size change
-- repricing it. Even the guest's answer can legitimately change, because a guest may ring up and
-- turn their booking into a Christmas dinner. What may never quietly change is the promise they
-- were given about getting their money back. To refund outside that promise, use the manager
-- override in refundActions, which records who decided and why.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freeze_table_booking_refund_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $freeze$
BEGIN
  -- Setting the terms for the first time is always allowed, so a backfill can fill in a booking
  -- taken before this existed. Changing them once set is not.
  IF OLD.deposit_refund_cutoff_days IS NOT NULL
     AND NEW.deposit_refund_cutoff_days IS DISTINCT FROM OLD.deposit_refund_cutoff_days THEN
    RAISE EXCEPTION
      'The refund terms on a booking cannot be changed. The guest was promised % days, and that promise is what a dispute is settled against.',
      OLD.deposit_refund_cutoff_days
      USING ERRCODE = '22023';
  END IF;

  IF OLD.deposit_refund_policy IS NOT NULL
     AND NEW.deposit_refund_policy IS DISTINCT FROM OLD.deposit_refund_policy THEN
    RAISE EXCEPTION
      'The refund policy recorded on a booking cannot be reworded after the guest has been given it.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$freeze$;

DROP TRIGGER IF EXISTS table_bookings_freeze_refund_terms ON public.table_bookings;
CREATE TRIGGER table_bookings_freeze_refund_terms
  BEFORE UPDATE OF deposit_refund_cutoff_days, deposit_refund_policy ON public.table_bookings
  FOR EACH ROW EXECUTE FUNCTION public.freeze_table_booking_refund_terms();

REVOKE ALL ON FUNCTION public.freeze_table_booking_refund_terms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_table_booking_refund_terms() TO service_role;

-- ---------------------------------------------------------------------------
-- Grants, restated for the new signatures and then PROVEN.
--
-- A new function in public on this project is granted EXECUTE to anon and authenticated BY NAME,
-- and REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. The core and the staff
-- entry point must be service_role only; the public entry point keeps the ACL it has always had,
-- because the website reaches it that way.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, uuid, boolean) TO anon, authenticated, service_role;

-- The core and the staff entry point must not be reachable by anon or authenticated. This FAILS the
-- migration rather than reporting success on a half-closed door.
--
-- IT ASKS POSTGRES, NOT THE ACL TEXT. Matching a regex against proacl has a hole that points the
-- wrong way: a function whose ACL has never been touched stores proacl NULL, meaning "the built-in
-- default", and for a function that default is EXECUTE TO PUBLIC. The regex finds no
-- "anon=X" in a NULL and reports all clear, while has_function_privilege('anon', ...) returns
-- true and anon really can call it. has_function_privilege is the question we actually mean.
DO $assert_grants$
DECLARE
  v_leaky text;
BEGIN
  SELECT string_agg(DISTINCT p.oid::regprocedure::text, ', ')
    INTO v_leaky
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_table_booking_core_v06',
      'create_table_booking_staff_v06',
      'freeze_table_booking_refund_terms')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'The privileged booking-create functions are executable by anon or authenticated.',
      DETAIL  = v_leaky,
      HINT    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role, and a NULL proacl still means EXECUTE TO PUBLIC. Revoke from anon and authenticated by name.';
  END IF;

  -- And the opposite mistake. Dropping the public entry point without restoring its grant would
  -- take every online booking down, silently, at the next deploy.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_table_booking_public_v06'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'create_table_booking_public_v06 is no longer executable by anon, so the website cannot take a booking.';
  END IF;
END;
$assert_grants$;

-- Prove the wiring landed, in the database rather than only in a code review. Each of these was a
-- separate way for this feature to look finished and charge nobody.
DO $assert_wiring$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_table_booking_core_v06';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'create_table_booking_core_v06 is missing.';
  END IF;
  IF v_src NOT LIKE '%resolve_table_booking_deposit%' THEN
    RAISE EXCEPTION 'The booking-create path does not resolve the deposit through resolve_table_booking_deposit.';
  END IF;
  IF v_src LIKE '%v_deposit_required := (p_party_size >= 10%' THEN
    RAISE EXCEPTION 'The booking-create path is still running the old hardcoded deposit rule.';
  END IF;
  IF v_src NOT LIKE '%booking_period_code%' OR v_src NOT LIKE '%deposit_refund_policy%' THEN
    RAISE EXCEPTION 'The booking-create path does not write the terms snapshot.';
  END IF;
END;
$assert_wiring$;

COMMIT;
