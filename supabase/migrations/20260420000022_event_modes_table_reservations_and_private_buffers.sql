-- Event booking modes, event-linked table reservations, and private booking table buffers.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS booking_mode text;

UPDATE public.events
SET booking_mode = 'table'
WHERE booking_mode IS NULL OR btrim(booking_mode) = '';

ALTER TABLE public.events
  ALTER COLUMN booking_mode SET DEFAULT 'table',
  ALTER COLUMN booking_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_booking_mode_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_booking_mode_check
      CHECK (booking_mode IN ('table', 'general', 'mixed'));
  END IF;
END $$;

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_table_bookings_event_id
  ON public.table_bookings (event_id);

CREATE INDEX IF NOT EXISTS idx_table_bookings_event_booking_id
  ON public.table_bookings (event_booking_id);

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
    CROSS JOIN LATERAL (
      SELECT
        normalized_window.window_start - INTERVAL '30 minutes' AS blocked_start,
        normalized_window.window_end + INTERVAL '30 minutes' AS blocked_end
    ) buffered_window
    WHERE t.id = p_table_id
      AND t.area_id IS NOT NULL
      AND pbi.item_type = 'space'
      AND pbi.space_id IS NOT NULL
      AND pb.status IN ('draft', 'confirmed')
      AND (p_exclude_private_booking_id IS NULL OR pb.id <> p_exclude_private_booking_id)
      AND buffered_window.blocked_start < p_window_end
      AND buffered_window.blocked_end > p_window_start
  )
  INTO v_is_blocked;

  RETURN COALESCE(v_is_blocked, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamptz, timestamptz, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_event_booking_v05(
  p_event_id uuid,
  p_customer_id uuid,
  p_seats integer,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_status text;
  v_booking_id uuid;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'invalid_seats'
    );
  END IF;

  SELECT
    e.id,
    e.name,
    e.capacity,
    e.payment_mode,
    e.booking_open,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_not_found'
    );
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_datetime_missing'
    );
  END IF;

  IF v_event_start <= NOW() THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_started'
    );
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_closed'
    );
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'not_bookable'
    );
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  -- NULL event capacity means unlimited seats.
  IF v_capacity_snapshot.capacity IS NOT NULL
     AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < p_seats) THEN
    RETURN jsonb_build_object(
      'state', 'full_with_waitlist_option',
      'reason', 'insufficient_capacity',
      'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0)
    );
  END IF;

  v_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, NOW() + INTERVAL '24 hours');

    IF v_hold_expires_at <= NOW() THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'event_started'
      );
    END IF;
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_customer_id,
    p_event_id,
    p_seats,
    v_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_hold_expires_at,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_booking_id;

  IF v_status = 'pending_payment' THEN
    INSERT INTO public.booking_holds (
      hold_type,
      event_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_booking_id,
      p_seats,
      'active',
      v_hold_expires_at,
      NOW(),
      NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at,
    'seats_remaining', CASE
      WHEN v_capacity_snapshot.capacity IS NULL THEN NULL
      ELSE GREATEST(v_capacity_snapshot.seats_remaining - p_seats, 0)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_event_waitlist_entry_v05(
  p_event_id uuid,
  p_customer_id uuid,
  p_requested_seats integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_existing RECORD;
  v_waitlist_entry_id uuid;
  v_event_start timestamptz;
BEGIN
  IF p_requested_seats IS NULL OR p_requested_seats < 1 THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'invalid_requested_seats'
    );
  END IF;

  SELECT
    e.id,
    e.capacity,
    e.booking_open,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_not_found'
    );
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_started'
    );
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_closed'
    );
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'not_bookable'
    );
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  -- NULL event capacity means unlimited seats, so waitlist is not needed.
  IF v_capacity_snapshot.capacity IS NULL
     OR COALESCE(v_capacity_snapshot.seats_remaining, 0) >= p_requested_seats THEN
    RETURN jsonb_build_object(
      'state', 'not_full',
      'reason', 'capacity_available',
      'seats_remaining', v_capacity_snapshot.seats_remaining
    );
  END IF;

  SELECT id, status
  INTO v_existing
  FROM public.waitlist_entries
  WHERE event_id = p_event_id
    AND customer_id = p_customer_id
    AND status IN ('queued', 'offered')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'queued',
      'waitlist_entry_id', v_existing.id,
      'existing', true
    );
  END IF;

  INSERT INTO public.waitlist_entries (
    event_id,
    customer_id,
    requested_seats,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_event_id,
    p_customer_id,
    p_requested_seats,
    'queued',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_waitlist_entry_id;

  RETURN jsonb_build_object(
    'state', 'queued',
    'waitlist_entry_id', v_waitlist_entry_id,
    'existing', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_waitlist_entry_v05(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_waitlist_entry_v05(uuid, uuid, integer) TO service_role;

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
  v_event RECORD;
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_reservation_start timestamptz;
  v_reservation_start_local timestamp without time zone;
  v_reservation_date date;
  v_reservation_time time without time zone;
  v_table_result jsonb := '{}'::jsonb;
  v_table_state text;
  v_table_booking_id uuid;
  v_current_assignment_end timestamptz;
  v_conflict_exists boolean := false;
  v_duration_minutes integer;
  v_booking_reference text;
  v_table_names text[];
  v_note_text text;
  v_source text := COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'admin');
BEGIN
  IF p_event_id IS NULL OR p_customer_id IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_request');
  END IF;

  IF p_party_size > 20 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  SELECT
    e.id,
    e.name,
    e.booking_mode,
    e.booking_open,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time,
    e.end_time,
    e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'general' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_general_entry_only');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_datetime_missing');
  END IF;

  v_event_end := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    v_event_start + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF v_event_end <= v_event_start THEN
    v_event_end := v_event_end + INTERVAL '1 day';
  END IF;

  v_reservation_start := v_event_start - INTERVAL '15 minutes';
  v_reservation_start_local := v_reservation_start AT TIME ZONE 'Europe/London';
  v_reservation_date := v_reservation_start_local::date;
  v_reservation_time := v_reservation_start_local::time without time zone;

  v_note_text := concat_ws(
    ' · ',
    CASE WHEN COALESCE(v_event.name, '') = '' THEN NULL ELSE 'Event: ' || v_event.name END,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL THEN
    v_table_result := public.create_table_booking_v05_core(
      p_customer_id,
      v_reservation_date,
      v_reservation_time,
      p_party_size,
      'drinks',
      v_note_text,
      false,
      v_source
    );
  ELSE
    v_table_result := public.create_table_booking_v05(
      p_customer_id,
      v_reservation_date,
      v_reservation_time,
      p_party_size,
      'drinks',
      v_note_text,
      false,
      v_source
    );
  END IF;

  v_table_state := COALESCE(v_table_result->>'state', 'blocked');
  IF v_table_state NOT IN ('confirmed', 'pending_card_capture') THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', COALESCE(v_table_result->>'reason', 'no_table')
    );
  END IF;

  v_table_booking_id := NULLIF(v_table_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END IF;

  UPDATE public.booking_holds
  SET status = 'released',
      released_at = NOW(),
      updated_at = NOW()
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'card_capture_hold'
    AND status = 'active';

  UPDATE public.card_captures
  SET status = 'expired',
      expires_at = NOW(),
      updated_at = NOW()
  WHERE table_booking_id = v_table_booking_id
    AND status = 'pending';

  UPDATE public.table_bookings
  SET status = 'confirmed'::public.table_booking_status,
      confirmed_at = COALESCE(confirmed_at, NOW()),
      card_capture_required = false,
      hold_expires_at = NULL,
      source = v_source,
      booking_type = 'regular'::public.table_booking_type,
      booking_purpose = 'drinks',
      special_requirements = COALESCE(v_note_text, special_requirements),
      event_id = p_event_id,
      event_booking_id = p_event_booking_id,
      updated_at = NOW()
  WHERE id = v_table_booking_id;

  SELECT MAX(end_datetime)
  INTO v_current_assignment_end
  FROM public.booking_table_assignments
  WHERE table_booking_id = v_table_booking_id;

  IF v_current_assignment_end IS NULL THEN
    v_current_assignment_end := v_reservation_start;
  END IF;

  IF v_event_end > v_current_assignment_end THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.booking_table_assignments current_bta
      JOIN public.booking_table_assignments other_bta
        ON other_bta.table_id = current_bta.table_id
      JOIN public.table_bookings other_tb
        ON other_tb.id = other_bta.table_booking_id
      WHERE current_bta.table_booking_id = v_table_booking_id
        AND other_bta.table_booking_id <> v_table_booking_id
        AND other_tb.status <> 'cancelled'::public.table_booking_status
        AND other_bta.start_datetime < v_event_end
        AND other_bta.end_datetime > v_current_assignment_end
    ) INTO v_conflict_exists;

    IF v_conflict_exists THEN
      DELETE FROM public.table_bookings
      WHERE id = v_table_booking_id;

      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END IF;
  END IF;

  v_duration_minutes := GREATEST(
    30,
    CEIL(EXTRACT(EPOCH FROM (v_event_end - v_reservation_start)) / 60.0)::integer
  );

  UPDATE public.booking_table_assignments
  SET start_datetime = v_reservation_start,
      end_datetime = v_event_end
  WHERE table_booking_id = v_table_booking_id;

  UPDATE public.table_bookings
  SET booking_date = v_reservation_date,
      booking_time = v_reservation_time,
      start_datetime = v_reservation_start,
      end_datetime = v_event_end,
      duration_minutes = v_duration_minutes,
      hold_expires_at = NULL,
      updated_at = NOW()
  WHERE id = v_table_booking_id;

  SELECT booking_reference
  INTO v_booking_reference
  FROM public.table_bookings
  WHERE id = v_table_booking_id;

  SELECT
    array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name))
  INTO v_table_names
  FROM public.booking_table_assignments bta
  JOIN public.tables t ON t.id = bta.table_id
  WHERE bta.table_booking_id = v_table_booking_id;

  RETURN jsonb_build_object(
    'state', 'confirmed',
    'table_booking_id', v_table_booking_id,
    'booking_reference', v_booking_reference,
    'table_name', CASE
      WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
      ELSE array_to_string(v_table_names, ' + ')
    END,
    'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
    'start_datetime', v_reservation_start,
    'end_datetime', v_event_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) TO service_role;
