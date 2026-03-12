-- Fix: broken overlap check in the event-window extension guard inside
-- create_event_table_reservation_v05.
--
-- Problem: after successfully allocating a table, the function checks whether
-- extending the assignment to cover the full event window (v_event_end) would
-- conflict with any other active bookings on that table.  The conflict query at
-- lines 332-352 of 20260421000002 filtered with:
--
--   AND other_tb.status <> 'cancelled'
--
-- This treats 'no_show' bookings and bookings where guests have already left
-- (left_at IS NOT NULL) as active conflicts.  The result:
--
--   1. create_table_booking_v05_core_legacy allocates a table (correctly, after
--      migration 20260509000008 fixed its own overlap check).
--   2. The event-window extension guard then sees a stale no_show booking on
--      the same table in the later window, incorrectly detects a conflict, and
--      deletes the just-created table booking before returning no_table.
--
-- Fix: mirror the corrected guard from 20260509000008 — exclude cancelled,
-- no_show, and bookings where the guest has already left (left_at IS NOT NULL).

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
  v_booking RECORD;

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
  v_table_ids uuid[];

  v_note_text text;
  v_source text := COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'admin');

  v_target_status public.table_booking_status;
  v_target_hold_expires_at timestamptz;
BEGIN
  IF p_event_id IS NULL
     OR p_event_booking_id IS NULL
     OR p_customer_id IS NULL
     OR p_party_size IS NULL
     OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_request');
  END IF;

  IF p_party_size > 20 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  -- Lock booking row to make the reservation idempotent per booking id.
  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.status,
    b.seats,
    b.hold_expires_at
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.event_id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_mismatch');
  END IF;

  IF v_booking.customer_id IS DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_mismatch');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_active');
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

  IF v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
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

  -- Avoid creating a reservation window in the past (create_table_booking_v05_core blocks "in_past").
  v_reservation_start := v_event_start - INTERVAL '15 minutes';
  IF v_reservation_start <= NOW() THEN
    v_reservation_start := v_event_start;
  END IF;

  v_reservation_start_local := v_reservation_start AT TIME ZONE 'Europe/London';
  v_reservation_date := v_reservation_start_local::date;
  v_reservation_time := v_reservation_start_local::time without time zone;

  v_note_text := concat_ws(
    ' · ',
    CASE WHEN COALESCE(v_event.name, '') = '' THEN NULL ELSE 'Event: ' || v_event.name END,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  IF v_booking.status = 'pending_payment' THEN
    v_target_status := 'pending_payment'::public.table_booking_status;
    v_target_hold_expires_at := v_booking.hold_expires_at;
  ELSE
    v_target_status := 'confirmed'::public.table_booking_status;
    v_target_hold_expires_at := NULL;
  END IF;

  -- Idempotency: if we already have a linked (non-cancelled) table booking, update the essentials and return it.
  SELECT tb.id
  INTO v_table_booking_id
  FROM public.table_bookings tb
  WHERE tb.event_booking_id = p_event_booking_id
    AND tb.status <> 'cancelled'::public.table_booking_status
  ORDER BY tb.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_table_booking_id IS NOT NULL THEN
    UPDATE public.table_bookings
    SET
      party_size = p_party_size,
      committed_party_size = p_party_size,
      status = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.status
        ELSE v_target_status
      END,
      confirmed_at = CASE
        WHEN v_target_status = 'confirmed'::public.table_booking_status
          THEN COALESCE(tb.confirmed_at, NOW())
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.confirmed_at
        ELSE NULL
      END,
      hold_expires_at = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.hold_expires_at
        ELSE v_target_hold_expires_at
      END,
      card_capture_required = false,
      source = v_source,
      booking_type = 'regular'::public.table_booking_type,
      booking_purpose = 'drinks',
      special_requirements = COALESCE(v_note_text, tb.special_requirements),
      event_id = p_event_id,
      event_booking_id = p_event_booking_id,
      updated_at = NOW()
    FROM public.table_bookings tb
    WHERE public.table_bookings.id = v_table_booking_id
      AND tb.id = v_table_booking_id;

    SELECT tb.booking_reference, tb.start_datetime, tb.end_datetime
    INTO v_booking_reference, v_reservation_start, v_event_end
    FROM public.table_bookings tb
    WHERE tb.id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
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
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  END IF;

  -- Create a fresh reservation using the current allocation logic.
  BEGIN
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

    -- Ensure any card-capture artifacts are cleared for event-linked reservations.
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

    -- Link to event booking and set the correct status/hold alignment.
    UPDATE public.table_bookings
    SET status = v_target_status,
        confirmed_at = CASE
          WHEN v_target_status = 'confirmed'::public.table_booking_status THEN COALESCE(confirmed_at, NOW())
          ELSE NULL
        END,
        card_capture_required = false,
        hold_expires_at = v_target_hold_expires_at,
        source = v_source,
        booking_type = 'regular'::public.table_booking_type,
        booking_purpose = 'drinks',
        special_requirements = COALESCE(v_note_text, special_requirements),
        event_id = p_event_id,
        event_booking_id = p_event_booking_id,
        party_size = p_party_size,
        committed_party_size = p_party_size,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    -- Ensure the extended event window doesn't overlap other active assignments.
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
          -- FIX: exclude no_show and already-departed bookings from conflict detection
          AND other_tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
          AND other_tb.left_at IS NULL
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

    -- Extend the assignment window to cover the event.
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
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    SELECT booking_reference
    INTO v_booking_reference
    FROM public.table_bookings
    WHERE id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
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
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', v_target_status::text,
      'hold_expires_at', v_target_hold_expires_at
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- Any failure here should be treated as no table for the event window.
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) TO service_role;
