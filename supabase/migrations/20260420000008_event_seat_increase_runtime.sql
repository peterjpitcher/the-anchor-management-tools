-- v0.5 prepaid event seat increase runtime helper

CREATE OR REPLACE FUNCTION public.apply_event_seat_increase_payment_v05(
  p_event_booking_id uuid,
  p_target_seats integer,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount numeric,
  p_currency text DEFAULT 'GBP'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_old_seats integer;
  v_delta integer;
  v_capacity_snapshot RECORD;
  v_payment_id uuid;
BEGIN
  IF p_target_seats IS NULL OR p_target_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_target_seats');
  END IF;

  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.seats,
    b.status
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_not_confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id
    );
  END IF;

  v_old_seats := COALESCE(v_booking.seats, 1);
  IF p_target_seats <= v_old_seats THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'invalid_target_seats',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id
    );
  END IF;

  v_delta := p_target_seats - v_old_seats;

  SELECT
    e.id,
    e.name,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_not_found',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id
    );
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'event_started',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_event.id
    );
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[v_event.id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < v_delta THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'insufficient_capacity',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_event.id,
      'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
      'required_delta', v_delta
    );
  END IF;

  UPDATE public.bookings
  SET
    seats = p_target_seats,
    updated_at = NOW()
  WHERE id = v_booking.id;

  UPDATE public.payments
  SET
    status = 'succeeded',
    stripe_payment_intent_id = COALESCE(NULLIF(TRIM(p_payment_intent_id), ''), stripe_payment_intent_id),
    amount = COALESCE(p_amount, amount),
    currency = COALESCE(NULLIF(TRIM(p_currency), ''), currency),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'target_seats_applied', p_target_seats,
      'delta_applied', v_delta,
      'applied_at', NOW()
    )
  WHERE event_booking_id = p_event_booking_id
    AND charge_type = 'seat_increase'
    AND stripe_checkout_session_id = p_checkout_session_id
  RETURNING id INTO v_payment_id;

  IF NOT FOUND THEN
    INSERT INTO public.payments (
      event_booking_id,
      charge_type,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      p_event_booking_id,
      'seat_increase',
      NULLIF(TRIM(p_payment_intent_id), ''),
      p_checkout_session_id,
      COALESCE(p_amount, 0),
      COALESCE(NULLIF(TRIM(p_currency), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'target_seats_applied', p_target_seats,
        'delta_applied', v_delta,
        'source', 'stripe_webhook'
      ),
      NOW()
    )
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'old_seats', v_old_seats,
    'new_seats', p_target_seats,
    'delta', v_delta,
    'payment_id', v_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_event_seat_increase_payment_v05(uuid, integer, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_event_seat_increase_payment_v05(uuid, integer, text, text, numeric, text) TO service_role;
