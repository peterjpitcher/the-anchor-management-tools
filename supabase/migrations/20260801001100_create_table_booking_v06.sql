-- Table prioritisation, stream B tasks B5 and B6.
-- create_table_booking_v06: the booking function, split into a public and a staff entry point.
--
-- Built by diffing the live v05 (md5 0a871e0bdd89f10f5f8f0f9156384ad0, captured 2026-07-27). Every
-- guard, blocked reason, deposit rule, hold, payment row and response field is carried over. What
-- changes:
--
--   * Table selection delegates to find_table_allocation_candidates, so the private-booking check,
--     the two house orders, minimum party sizes, holds, accessibility and high-chair suitability all
--     apply. That is the whole point of the release.
--   * The advisory lock moves AHEAD of selection, so a lost race retries onto another table instead
--     of refusing the customer.
--   * The hard "party >= 21" guard becomes a parameter, so staff can take a large booking while the
--     website still refuses it.
--   * Turn times by party size, and a turnaround gap on the ASSIGNMENT window only, so the guest is
--     never told a longer time than they have.
--   * Outside bookings get a durable reservation row and a real cap.
--
-- REVIEW FINDING F4 (security). v05 takes no channel and is granted to anon. If v06 took a channel
-- or an override from its caller while keeping that grant, any anonymous caller could claim to be
-- staff and bypass the online party limit, the holds and the minimums. So there are two entry
-- points and one shared core:
--
--   create_table_booking_public_v06   anon, authenticated, service_role.
--                                     Channel hard-coded 'online'. No pin. No overrides.
--   create_table_booking_staff_v06    service_role ONLY.
--                                     Channel, pin, overrides and actor, all supplied by an AMS
--                                     route that has already run its RBAC check.
--
-- Authority is proven at the route boundary, never by a parameter.
--
-- REVIEW FINDING F6 (gate). When table_allocation_v06_enabled is false the core delegates the whole
-- call to v05, rather than gating selection alone. Deploying this changes nothing until the flag is
-- turned on, and turning it off returns every path to its old behaviour exactly.

BEGIN;

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
  p_actor_id                  uuid
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
BEGIN
  -- =========================================================================
  -- THE GATE. Off means v05, exactly, end to end.
  -- =========================================================================
  IF NOT public.get_setting_bool('table_allocation_v06_enabled', false) THEN
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
  -- Deposit, reference and insert. Carried over from v05.
  -- =========================================================================
  v_deposit_required := (p_party_size >= 10 OR v_is_christmas) AND NOT COALESCE(p_deposit_waived, false);

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
  v_deposit_amount := ROUND((v_party_size_eff::numeric) * 10.0, 2);

  INSERT INTO public.table_bookings (
    customer_id, booking_reference, booking_date, booking_time, booking_type, status,
    party_size, special_requirements, duration_minutes, source, confirmed_at, booking_purpose,
    committed_party_size, hold_expires_at, payment_method, payment_status,
    start_datetime, end_datetime, sunday_preorder_cutoff_at, deposit_waived,
    high_chair_count, is_outside_seating, requires_accessible_table,
    table_pinned, assignment_soft, created_at, updated_at
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
    v_now, v_now
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
        'deposit_per_person', 10,
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
    'requires_accessible_table', COALESCE(p_requires_accessible_table, false)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- PUBLIC entry point. Same 13 parameters as v05 so every existing caller
-- compiles unchanged, plus one optional accessibility flag.
--
-- It cannot be told who is calling. Channel is hard-coded, there are no
-- overrides, nothing can be pinned, and the party ceiling is the online one.
-- ---------------------------------------------------------------------------
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
  p_requires_accessible_table boolean DEFAULT false
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
    NULL, NULL
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- STAFF entry point. service_role only. Every privileged input lives here, and
-- the AMS route that calls it has already run its RBAC check.
-- ---------------------------------------------------------------------------
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
  p_actor_id         uuid DEFAULT NULL
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
    p_overrides, p_actor_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Grants. This is the security fix, so it is explicit.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid) FROM PUBLIC;

-- Core: reachable only through the two entry points.
GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid) TO service_role;

-- Public: reproduces v05's ACL, because the website reaches it the same way.
GRANT EXECUTE ON FUNCTION public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean) TO anon, authenticated, service_role;

-- Staff: service_role ONLY. This is the whole point of the split.
GRANT EXECUTE ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid) TO service_role;

COMMIT;
