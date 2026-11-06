-- Rollback for 20261106112933_event_rehold_supersedes_lapsed_hold.sql.
-- Puts create_event_booking_v05 back exactly as production held it on 6 November 2026
-- (pg_get_functiondef md5 583e6a10e772ab1f5b608cb6c102b5be, md5(prosrc)
-- 7ee06c16846fa8a22e57382a6ad37db5), so a guest's lapsed hold for an event is refused as
-- customer_conflict again until the hold job expires it. Function only: bookings that already gave
-- way stay expired and their written-off PayPal orders stay failed. Restores the whole body, so if
-- another release has changed create_event_booking_v05 since, rebuild this file first. Safe to
-- run twice.

CREATE OR REPLACE FUNCTION public.create_event_booking_v05(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_after_snapshot RECORD;
  v_existing_active RECORD;
  v_status text;
  v_booking_id uuid;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_requested_seating text := CASE WHEN p_seating_preference = 'standing' THEN 'standing' ELSE 'seated' END;
  v_effective_seating text := 'seated';
  v_allocation jsonb := '{}'::jsonb;
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    e.id,
    e.name,
    e.capacity,
    e.payment_mode,
    e.booking_mode,
    e.booking_open,
    e.bookings_enabled,
    e.booking_cutoff_at,
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

  SELECT start_datetime, end_datetime
  INTO v_window_start, v_window_end
  FROM public.event_communal_window_v01(p_event_id);

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    v_window_start := v_event_start;
    v_window_end := v_event_end;
  END IF;

  IF v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  -- Owner decision D24 (customer bookings review, 24 October 2026): a whole-pub private hire
  -- stops ticket sales for an event it overlaps. The guest is told booking has closed.
  IF EXISTS (SELECT 1 FROM public.events_closed_by_whole_pub_hire(ARRAY[p_event_id])) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  -- BK-089: a postponed night has no date to book.
  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft', 'postponed') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  -- BK-035, owner decision D11: Accept bookings and the online sales close time apply to the
  -- website, waitlist acceptances and text replies. Staff and FOH bookings are not limited by them.
  IF COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site') IN ('brand_site', 'sms_reply') THEN
    IF COALESCE(v_event.bookings_enabled, true) = false THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'bookings_disabled');
    END IF;
    IF v_event.booking_cutoff_at IS NOT NULL AND v_event.booking_cutoff_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'sales_closed');
    END IF;
  END IF;

  SELECT b.id, b.status
  INTO v_existing_active
  FROM public.bookings b
  WHERE b.event_id = p_event_id
    AND b.customer_id = p_customer_id
    AND b.status IN ('pending_payment', 'confirmed')
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'customer_conflict',
      'booking_id', v_existing_active.id,
      'status', v_existing_active.status
    );
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
    IF v_requested_seating = 'standing' THEN
      -- Only staff may choose standing while seated places remain.
      IF COALESCE(p_source, '') NOT IN ('admin', 'foh', 'walk-in')
         AND v_capacity_snapshot.seated_remaining IS DISTINCT FROM 0 THEN
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'standing_not_available_until_seated_full',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_capacity, 0) <= 0 THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'standing_capacity_not_configured');
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_remaining, 0) < p_seats THEN
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;

      v_effective_seating := 'standing';
    ELSE
      IF COALESCE(v_capacity_snapshot.seated_remaining, 0) >= p_seats THEN
        v_effective_seating := 'seated';
      ELSIF (COALESCE(v_capacity_snapshot.seated_remaining, 0) > 0
              OR COALESCE(v_capacity_snapshot.standing_remaining, 0) > 0) THEN
        -- The guest must review standing tickets before making a new request.
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'seated_capacity_changed',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      ELSE
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;
    END IF;
  ELSE
    IF v_capacity_snapshot.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < p_seats) THEN
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0)
      );
    END IF;
  END IF;

  v_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, now() + INTERVAL '24 hours');
    IF v_hold_expires_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
    END IF;
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    event_seating_type,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_customer_id,
    p_event_id,
    p_seats,
    v_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_effective_seating,
    v_hold_expires_at,
    now(),
    now()
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
      now(),
      now()
    );
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' AND v_effective_seating = 'seated' THEN
    v_allocation := public.allocate_event_communal_seats_v01(
      p_event_id,
      v_booking_id,
      p_seats,
      v_window_start,
      v_window_end
    );

    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      DELETE FROM public.booking_holds WHERE event_booking_id = v_booking_id;
      DELETE FROM public.bookings WHERE id = v_booking_id;
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity'),
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
        'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
        'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
      );
    END IF;
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
    v_allocation := public.create_event_table_reservation_v05(
      p_event_id, v_booking_id, p_customer_id, p_seats, p_source,
      'Event booking ' || v_booking_id::text
    );
    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P2002',
        MESSAGE = COALESCE(v_allocation->>'reason', 'no_table');
    END IF;
  END IF;

  SELECT *
  INTO v_after_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at,
    'event_seating_type', v_effective_seating,
    'seats_remaining', v_after_snapshot.seats_remaining,
    'seated_remaining', v_after_snapshot.seated_remaining,
    'standing_remaining', v_after_snapshot.standing_remaining,
    'total_remaining', v_after_snapshot.total_remaining,
    'table_booking_id', v_allocation->>'table_booking_id',
    'table_name', v_allocation->>'table_name',
    'table_names', COALESCE(v_allocation->'table_names', '[]'::jsonb),
    'table_ids', COALESCE(v_allocation->'table_ids', '[]'::jsonb)
  );
EXCEPTION
  WHEN SQLSTATE 'P2002' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
  WHEN unique_violation THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict');
END;
$function$;

-- Production's grants on 6 November 2026, restated as the migration does: service_role only.
REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) TO service_role;
