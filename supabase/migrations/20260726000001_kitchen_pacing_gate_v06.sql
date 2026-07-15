-- Redefine create_table_booking_v05: add kitchen pacing gate + advisory lock.
--
-- Adds an 11th parameter (p_bypass_pacing) and, when kitchen pacing is enabled,
-- caps how many food covers may ARRIVE in a rolling window centred on the
-- requested time. Covers headroom for walk-ins via a per-service reserve.
--
-- Ships INERT: gated on system_settings.kitchen_pacing_enabled, which defaults
-- to false (see 20260726000000_kitchen_pacing_settings.sql). Until a manager
-- switches it on, behaviour is identical to today.
--
-- The pacing block mirrors src/lib/table-bookings/kitchen-pacing.ts:
--   * counts booking_purpose='food' covers only;
--   * excludes cancelled/no_show, departed (left_at set), and expired unpaid holds;
--   * prefers committed_party_size over party_size;
--   * uses a CENTRED window [center - window/2, center + window/2);
--   * ceiling = GREATEST(0, pace - reserve), with Sunday numbers when DOW = 0
--     and per-date overrides from special_hours.
-- A date-keyed pg_advisory_xact_lock serialises count+insert so two concurrent
-- bookings can't both slip under the cap.
--
-- Signature changes (adds p_bypass_pacing) => DROP the old 10-arg signature
-- first to avoid an overload (the project already hit overload ambiguity in
-- 20260509000007). Body is otherwise the live definition verbatim.

DROP FUNCTION IF EXISTS public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean
);

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food'::text,
  p_notes text DEFAULT NULL::text,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'::text,
  p_bypass_cutoff boolean DEFAULT false,
  p_deposit_waived boolean DEFAULT false,
  p_bypass_pacing boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purpose text;
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

  -- Kitchen pacing (new).
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
  IF v_purpose NOT IN ('food', 'drinks') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_purpose');
  END IF;

  v_is_sunday := EXTRACT(DOW FROM p_booking_date)::integer = 0;
  IF COALESCE(p_sunday_lunch, false) AND NOT v_is_sunday THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'sunday_lunch_requires_sunday');
  END IF;

  v_booking_type := CASE
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

  -- Step 1: Try a single table that fits the whole party.
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
    -- Step 2: Try joined-table combinations via table_join_links.
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

  -- ===== KITCHEN PACING GATE (new) =====
  -- Seam: immediately after the no_table guard, before the deposit/status decision.
  -- Mirrors src/lib/table-bookings/kitchen-pacing.ts. Skips entirely when the caller
  -- is for drinks, bypasses (walk-ins / manager override), or the feature is disabled.
  IF v_purpose = 'food' AND NOT COALESCE(p_bypass_pacing, false) THEN
    SELECT COALESCE((value ->> 'value')::boolean, false)
      INTO v_pacing_enabled
      FROM public.system_settings WHERE key = 'kitchen_pacing_enabled';

    IF COALESCE(v_pacing_enabled, false) THEN
      -- v_is_sunday already resolved above from EXTRACT(DOW FROM p_booking_date).

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

      -- Serialise count+insert for this date so concurrent bookings can't both slip under the cap.
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
  -- ===== END KITCHEN PACING GATE =====

  v_deposit_required := p_party_size >= 10 AND NOT COALESCE(p_deposit_waived, false);

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
    v_now,
    v_now
  )
  RETURNING id INTO v_table_booking_id;

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
    'sunday_preorder_cutoff_at', v_sunday_preorder_cutoff_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean
) TO service_role;
