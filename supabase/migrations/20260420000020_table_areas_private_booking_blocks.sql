-- Add relational table areas and private-booking area blocking for table allocation.

CREATE TABLE IF NOT EXISTS public.table_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_areas_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_table_areas_name ON public.table_areas (name);

CREATE OR REPLACE FUNCTION public.set_table_area_normalized_name_v05()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name := regexp_replace(trim(COALESCE(NEW.name, '')), '\s+', ' ', 'g');

  IF NEW.name = '' THEN
    RAISE EXCEPTION 'Table area name is required';
  END IF;

  NEW.normalized_name := lower(NEW.name);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_table_area_normalized_name_v05 ON public.table_areas;
CREATE TRIGGER trg_set_table_area_normalized_name_v05
  BEFORE INSERT OR UPDATE ON public.table_areas
  FOR EACH ROW
  EXECUTE FUNCTION public.set_table_area_normalized_name_v05();

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.table_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tables_area_id
  ON public.tables (area_id);

INSERT INTO public.table_areas (name, normalized_name)
SELECT DISTINCT
  regexp_replace(trim(t.area), '\s+', ' ', 'g') AS name,
  lower(regexp_replace(trim(t.area), '\s+', ' ', 'g')) AS normalized_name
FROM public.tables t
WHERE t.area IS NOT NULL
  AND trim(t.area) <> ''
ON CONFLICT (normalized_name) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = now();

UPDATE public.tables t
SET area_id = ta.id
FROM public.table_areas ta
WHERE t.area_id IS NULL
  AND t.area IS NOT NULL
  AND trim(t.area) <> ''
  AND ta.normalized_name = lower(regexp_replace(trim(t.area), '\s+', ' ', 'g'));

UPDATE public.tables t
SET area = ta.name
FROM public.table_areas ta
WHERE t.area_id = ta.id
  AND (t.area IS DISTINCT FROM ta.name);

CREATE TABLE IF NOT EXISTS public.venue_space_table_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_space_id uuid NOT NULL REFERENCES public.venue_spaces(id) ON DELETE CASCADE,
  table_area_id uuid NOT NULL REFERENCES public.table_areas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_space_id, table_area_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_space_table_areas_space
  ON public.venue_space_table_areas (venue_space_id);

CREATE INDEX IF NOT EXISTS idx_venue_space_table_areas_area
  ON public.venue_space_table_areas (table_area_id);

INSERT INTO public.venue_space_table_areas (venue_space_id, table_area_id)
SELECT vs.id, ta.id
FROM public.venue_spaces vs
JOIN public.table_areas ta
  ON ta.normalized_name = lower(regexp_replace(trim(vs.name), '\s+', ' ', 'g'))
ON CONFLICT (venue_space_id, table_area_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_table_blocked_by_private_booking_v05(
  p_table_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_exclude_private_booking_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_blocked boolean := false;
BEGIN
  IF p_table_id IS NULL
     OR p_window_start IS NULL
     OR p_window_end IS NULL
     OR p_window_end <= p_window_start THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.tables t
    JOIN public.venue_space_table_areas vsta
      ON vsta.table_area_id = t.area_id
    JOIN public.private_booking_items pbi
      ON pbi.space_id = vsta.venue_space_id
    JOIN public.private_bookings pb
      ON pb.id = pbi.booking_id
    CROSS JOIN LATERAL (
      SELECT
        ((COALESCE(pb.setup_date, pb.event_date)::text || ' ' || COALESCE(pb.setup_time, pb.start_time)::text)::timestamp AT TIME ZONE 'Europe/London') AS window_start,
        CASE
          WHEN pb.end_time IS NOT NULL
            THEN ((pb.event_date::text || ' ' || pb.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
          ELSE (((pb.event_date::text || ' ' || pb.start_time::text)::timestamp AT TIME ZONE 'Europe/London') + INTERVAL '4 hours')
        END AS window_end_raw
    ) booking_window
    CROSS JOIN LATERAL (
      SELECT
        booking_window.window_start AS window_start,
        CASE
          WHEN booking_window.window_end_raw <= booking_window.window_start
            THEN booking_window.window_end_raw + INTERVAL '1 day'
          ELSE booking_window.window_end_raw
        END AS window_end
    ) normalized_window
    WHERE t.id = p_table_id
      AND t.area_id IS NOT NULL
      AND pbi.item_type = 'space'
      AND pbi.space_id IS NOT NULL
      AND pb.status IN ('draft', 'confirmed')
      AND (p_exclude_private_booking_id IS NULL OR pb.id <> p_exclude_private_booking_id)
      AND normalized_window.window_start < p_window_end
      AND normalized_window.window_end > p_window_start
  )
  INTO v_is_blocked;

  RETURN COALESCE(v_is_blocked, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamptz, timestamptz, uuid) TO service_role;

-- Add private-booking blocking to the table booking wrapper.
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

  v_result jsonb := '{}'::jsonb;
  v_table_booking_id uuid;
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

  v_result := public.create_table_booking_v05_core(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );

  IF COALESCE(v_result->>'state', 'blocked') NOT IN ('confirmed', 'pending_card_capture') THEN
    RETURN v_result;
  END IF;

  v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN v_result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    WHERE bta.table_booking_id = v_table_booking_id
      AND public.is_table_blocked_by_private_booking_v05(
        bta.table_id,
        bta.start_datetime,
        bta.end_datetime,
        NULL
      )
  ) THEN
    DELETE FROM public.table_bookings
    WHERE id = v_table_booking_id;

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'private_booking_blocked');
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;
