-- Add customer event overlap guard to table booking creation wrapper.

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
  v_food_duration_minutes integer := 120;
  v_drinks_duration_minutes integer := 90;
  v_sunday_duration_minutes integer := 120;
  v_duration_minutes integer;
  v_booking_start_local timestamp without time zone;
  v_booking_start timestamptz;
  v_booking_end timestamptz;
BEGIN
  IF p_booking_date IS NOT NULL
     AND p_booking_time IS NOT NULL
     AND NOT public.table_booking_matches_service_window_v05(
       p_booking_date,
       p_booking_time,
       p_booking_purpose,
       p_sunday_lunch
     ) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_service_window');
  END IF;

  v_purpose := LOWER(TRIM(COALESCE(p_booking_purpose, 'food')));
  IF v_purpose IN ('food', 'drinks')
     AND p_customer_id IS NOT NULL
     AND p_booking_date IS NOT NULL
     AND p_booking_time IS NOT NULL THEN
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

    v_booking_start_local := (p_booking_date::text || ' ' || p_booking_time::text)::timestamp;
    v_booking_start := v_booking_start_local AT TIME ZONE 'Europe/London';
    v_booking_end := v_booking_start + make_interval(mins => v_duration_minutes);

    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.events e ON e.id = b.event_id
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(
            e.start_datetime,
            CASE
              WHEN e.date IS NOT NULL AND e.time IS NOT NULL
                THEN ((e.date::text || ' ' || e.time::text)::timestamp AT TIME ZONE 'Europe/London')
              ELSE NULL
            END
          ) AS event_start,
          COALESCE(NULLIF(e.duration_minutes, 0), 180)::integer AS event_duration_minutes
      ) ew
      WHERE b.customer_id = p_customer_id
        AND b.event_id IS NOT NULL
        AND b.status NOT IN ('cancelled', 'expired')
        AND (
          b.status <> 'pending_payment'
          OR b.hold_expires_at IS NULL
          OR b.hold_expires_at > NOW()
        )
        AND COALESCE(e.event_status, 'scheduled') NOT IN ('cancelled', 'draft')
        AND ew.event_start IS NOT NULL
        AND ew.event_start < v_booking_end
        AND ew.event_start + make_interval(mins => ew.event_duration_minutes) > v_booking_start
    ) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict');
    END IF;
  END IF;

  IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  RETURN public.create_table_booking_v05_core(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;
