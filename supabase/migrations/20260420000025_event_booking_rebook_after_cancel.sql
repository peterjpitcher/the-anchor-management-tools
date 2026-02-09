-- Allow rebooking after cancelled/expired event bookings while preserving history.
-- Keep a uniqueness guard for active bookings only.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_customer_id_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_customer_event_active_unique
  ON public.bookings (customer_id, event_id)
  WHERE status IN ('pending_payment', 'confirmed');

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
  v_existing_active RECORD;
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

  SELECT
    b.id,
    b.status
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
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'customer_conflict'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text) TO service_role;
