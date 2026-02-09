-- v0.5 table booking runtime helpers

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food',
  p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  v_selected_table RECORD;
  v_table_booking_id uuid;
  v_booking_reference text;

  v_card_capture_required boolean := false;
  v_hold_expires_at timestamptz;
  v_now timestamptz := NOW();

  v_sunday_preorder_cutoff_at timestamptz;
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

    IF v_kitchen_booking_minutes > (v_kitchen_close_service_minutes - 30) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
    END IF;
  END IF;

  IF v_purpose = 'drinks' AND NOT COALESCE(v_drinks_near_close_allowed, false) THEN
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

  FOR v_selected_table IN
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS display_name,
      t.capacity
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) = true
      AND t.capacity >= p_party_size
    ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.booking_table_assignments bta
      JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
      WHERE bta.table_id = v_selected_table.id
        AND tb.status <> 'cancelled'::public.table_booking_status
        AND bta.start_datetime < v_booking_end
        AND bta.end_datetime > v_booking_start
    ) THEN
      EXIT;
    END IF;

    v_selected_table.id := NULL;
  END LOOP;

  IF v_selected_table.id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END IF;

  v_card_capture_required := COALESCE(p_sunday_lunch, false) OR (p_party_size BETWEEN 7 AND 20);

  IF v_card_capture_required THEN
    v_booking_status := 'pending_card_capture'::public.table_booking_status;
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
    card_capture_required,
    start_datetime,
    end_datetime,
    sunday_preorder_cutoff_at,
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
    v_card_capture_required,
    v_booking_start,
    v_booking_end,
    v_sunday_preorder_cutoff_at,
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
  ) VALUES (
    v_table_booking_id,
    v_selected_table.id,
    v_booking_start,
    v_booking_end,
    v_now
  );

  IF v_card_capture_required THEN
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
      'card_capture_hold',
      v_table_booking_id,
      p_party_size,
      'active',
      v_now,
      v_hold_expires_at,
      v_now,
      v_now
    );

    INSERT INTO public.card_captures (
      table_booking_id,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      v_table_booking_id,
      'pending',
      v_hold_expires_at,
      v_now,
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_booking_status = 'pending_card_capture'::public.table_booking_status THEN 'pending_card_capture'
      ELSE 'confirmed'
    END,
    'table_booking_id', v_table_booking_id,
    'booking_reference', v_booking_reference,
    'status', v_booking_status::text,
    'table_id', v_selected_table.id,
    'table_name', v_selected_table.display_name,
    'party_size', p_party_size,
    'booking_purpose', v_purpose,
    'booking_type', v_booking_type::text,
    'start_datetime', v_booking_start,
    'end_datetime', v_booking_end,
    'hold_expires_at', v_hold_expires_at,
    'card_capture_required', v_card_capture_required,
    'sunday_lunch', COALESCE(p_sunday_lunch, false),
    'sunday_preorder_cutoff_at', v_sunday_preorder_cutoff_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_table_card_capture_preview_v05(
  p_hashed_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_booking RECORD;
BEGIN
  SELECT
    gt.id,
    gt.customer_id,
    gt.table_booking_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'card_capture'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_used');
  END IF;

  IF v_token.expires_at <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.table_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT
    tb.id,
    tb.customer_id,
    tb.booking_reference,
    tb.booking_date,
    tb.booking_time,
    tb.party_size,
    tb.status,
    tb.booking_type,
    tb.booking_purpose,
    tb.hold_expires_at,
    tb.start_datetime,
    tb.end_datetime
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = v_token.table_booking_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_booking.status = 'confirmed'::public.table_booking_status THEN
    RETURN jsonb_build_object(
      'state', 'already_completed',
      'table_booking_id', v_booking.id,
      'booking_reference', v_booking.booking_reference,
      'status', v_booking.status::text,
      'hold_expires_at', v_booking.hold_expires_at
    );
  END IF;

  IF v_booking.status <> 'pending_card_capture'::public.table_booking_status THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_pending_card_capture');
  END IF;

  RETURN jsonb_build_object(
    'state', 'ready',
    'table_booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'booking_reference', v_booking.booking_reference,
    'booking_date', v_booking.booking_date,
    'booking_time', v_booking.booking_time,
    'party_size', v_booking.party_size,
    'booking_type', v_booking.booking_type::text,
    'booking_purpose', v_booking.booking_purpose,
    'status', v_booking.status::text,
    'hold_expires_at', v_booking.hold_expires_at,
    'start_datetime', v_booking.start_datetime,
    'end_datetime', v_booking.end_datetime
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_table_card_capture_preview_v05(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_card_capture_preview_v05(text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_table_card_capture_v05(
  p_table_booking_id uuid,
  p_setup_intent_id text,
  p_payment_method_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_card_capture_id uuid;
  v_now timestamptz := NOW();
BEGIN
  IF p_table_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT
    tb.id,
    tb.customer_id,
    tb.booking_reference,
    tb.booking_date,
    tb.booking_time,
    tb.party_size,
    tb.status
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = p_table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.status = 'confirmed'::public.table_booking_status THEN
    RETURN jsonb_build_object(
      'state', 'already_confirmed',
      'table_booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'booking_reference', v_booking.booking_reference,
      'status', v_booking.status::text
    );
  END IF;

  IF v_booking.status <> 'pending_card_capture'::public.table_booking_status THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_not_pending_card_capture',
      'table_booking_id', v_booking.id,
      'status', v_booking.status::text
    );
  END IF;

  UPDATE public.table_bookings
  SET
    status = 'confirmed'::public.table_booking_status,
    confirmed_at = v_now,
    card_capture_completed_at = v_now,
    hold_expires_at = NULL,
    updated_at = v_now
  WHERE id = v_booking.id;

  UPDATE public.booking_holds
  SET
    status = 'consumed',
    consumed_at = v_now,
    updated_at = v_now
  WHERE table_booking_id = v_booking.id
    AND hold_type = 'card_capture_hold'
    AND status = 'active';

  UPDATE public.card_captures
  SET
    status = 'completed',
    stripe_setup_intent_id = COALESCE(NULLIF(TRIM(COALESCE(p_setup_intent_id, '')), ''), stripe_setup_intent_id),
    stripe_payment_method_id = COALESCE(NULLIF(TRIM(COALESCE(p_payment_method_id, '')), ''), stripe_payment_method_id),
    captured_at = v_now,
    updated_at = v_now
  WHERE table_booking_id = v_booking.id
    AND status IN ('pending', 'expired')
  RETURNING id INTO v_card_capture_id;

  IF NOT FOUND THEN
    INSERT INTO public.card_captures (
      table_booking_id,
      stripe_setup_intent_id,
      stripe_payment_method_id,
      status,
      expires_at,
      captured_at,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      NULLIF(TRIM(COALESCE(p_setup_intent_id, '')), ''),
      NULLIF(TRIM(COALESCE(p_payment_method_id, '')), ''),
      'completed',
      NULL,
      v_now,
      v_now,
      v_now
    )
    RETURNING id INTO v_card_capture_id;
  END IF;

  UPDATE public.guest_tokens
  SET consumed_at = v_now
  WHERE table_booking_id = v_booking.id
    AND action_type = 'card_capture'
    AND consumed_at IS NULL;

  RETURN jsonb_build_object(
    'state', 'confirmed',
    'table_booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'booking_reference', v_booking.booking_reference,
    'booking_date', v_booking.booking_date,
    'booking_time', v_booking.booking_time,
    'party_size', v_booking.party_size,
    'status', 'confirmed',
    'card_capture_id', v_card_capture_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_table_card_capture_v05(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_table_card_capture_v05(uuid, text, text) TO service_role;
