-- Harden table assignment logic: private-booking-aware allocation, overlap-safe assignment writes,
-- and post-allocation private-block enforcement for event-linked table reservations.

CREATE OR REPLACE FUNCTION public.create_table_booking_v05_core_legacy(
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

  v_selected_table_id uuid;
  v_selected_table_ids uuid[];
  v_selected_table_names text[];
  v_selected_table_display_name text;

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

  SELECT
    t.id,
    COALESCE(t.name, t.table_number) AS display_name
  INTO v_selected_table_id, v_selected_table_display_name
  FROM public.tables t
  WHERE COALESCE(t.is_bookable, true) = true
    AND t.capacity >= p_party_size
    AND NOT public.is_table_blocked_by_private_booking_v05(
      t.id,
      v_booking_start,
      v_booking_end,
      NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_table_assignments bta
      JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
      WHERE bta.table_id = t.id
        AND tb.status <> 'cancelled'::public.table_booking_status
        AND bta.start_datetime < v_booking_end
        AND bta.end_datetime > v_booking_start
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
        AND NOT public.is_table_blocked_by_private_booking_v05(
          t.id,
          v_booking_start,
          v_booking_end,
          NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.booking_table_assignments bta
          JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
          WHERE bta.table_id = t.id
            AND tb.status <> 'cancelled'::public.table_booking_status
            AND bta.start_datetime < v_booking_end
            AND bta.end_datetime > v_booking_start
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
      WHERE cardinality(c.table_ids) < 4
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
  )
  SELECT
    v_table_booking_id,
    selected_table_id,
    v_booking_start,
    v_booking_end,
    v_now
  FROM unnest(v_selected_table_ids) AS selected_table_id;

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
    'card_capture_required', v_card_capture_required,
    'sunday_lunch', COALESCE(p_sunday_lunch, false),
    'sunday_preorder_cutoff_at', v_sunday_preorder_cutoff_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05_core_legacy(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05_core_legacy(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_table_assignments_window_check'
  ) THEN
    ALTER TABLE public.booking_table_assignments
      ADD CONSTRAINT booking_table_assignments_window_check
      CHECK (end_datetime > start_datetime);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_status public.table_booking_status;
BEGIN
  IF NEW.start_datetime IS NULL
     OR NEW.end_datetime IS NULL
     OR NEW.end_datetime <= NEW.start_datetime THEN
    RAISE EXCEPTION 'table_assignment_invalid_window'
      USING ERRCODE = '22023',
            DETAIL = 'end_datetime must be greater than start_datetime';
  END IF;

  SELECT tb.status
  INTO v_new_status
  FROM public.table_bookings tb
  WHERE tb.id = NEW.table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_booking_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF v_new_status = 'cancelled'::public.table_booking_status THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.tables t
  WHERE t.id = NEW.table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF public.is_table_blocked_by_private_booking_v05(
    NEW.table_id,
    NEW.start_datetime,
    NEW.end_datetime,
    NULL
  ) THEN
    RAISE EXCEPTION 'table_assignment_private_blocked'
      USING ERRCODE = '23P01',
            DETAIL = 'table is blocked by an overlapping private booking window';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      AND tb.status <> 'cancelled'::public.table_booking_status
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
      AND (TG_OP <> 'UPDATE' OR bta.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping active assignment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_booking_table_assignment_integrity_v05 ON public.booking_table_assignments;
CREATE TRIGGER trg_enforce_booking_table_assignment_integrity_v05
  BEFORE INSERT OR UPDATE ON public.booking_table_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_table_assignment_integrity_v05();

REVOKE ALL ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.create_event_table_reservation_v05_legacy(uuid,uuid,uuid,integer,text,text)') IS NULL
     AND to_regprocedure('public.create_event_table_reservation_v05(uuid,uuid,uuid,integer,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text)
      RENAME TO create_event_table_reservation_v05_legacy;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_event_table_reservation_v05(
  p_event_id uuid,
  p_event_booking_id uuid,
  p_customer_id uuid,
  p_party_size integer,
  p_source text DEFAULT 'admin',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_state text := 'blocked';
  v_table_booking_id uuid;
  v_window_start timestamptz;
  v_window_end timestamptz;
BEGIN
  IF to_regprocedure('public.create_event_table_reservation_v05_legacy(uuid,uuid,uuid,integer,text,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END IF;

  v_result := public.create_event_table_reservation_v05_legacy(
    p_event_id,
    p_event_booking_id,
    p_customer_id,
    p_party_size,
    p_source,
    p_notes
  );

  v_state := COALESCE(v_result->>'state', 'blocked');
  IF v_state <> 'confirmed' THEN
    RETURN v_result;
  END IF;

  v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN v_result;
  END IF;

  v_window_start := NULLIF(v_result->>'start_datetime', '')::timestamptz;
  v_window_end := NULLIF(v_result->>'end_datetime', '')::timestamptz;

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    SELECT tb.start_datetime, tb.end_datetime
    INTO v_window_start, v_window_end
    FROM public.table_bookings tb
    WHERE tb.id = v_table_booking_id;
  END IF;

  IF v_window_start IS NULL OR v_window_end IS NULL OR v_window_end <= v_window_start THEN
    RETURN v_result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    WHERE bta.table_booking_id = v_table_booking_id
      AND public.is_table_blocked_by_private_booking_v05(
        bta.table_id,
        v_window_start,
        v_window_end,
        NULL
      )
  ) THEN
    DELETE FROM public.table_bookings
    WHERE id = v_table_booking_id;

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) TO service_role;
