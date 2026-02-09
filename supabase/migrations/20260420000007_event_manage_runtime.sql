-- v0.5 guest manage-booking runtime helpers

CREATE OR REPLACE FUNCTION public.get_event_booking_manage_preview_v05(
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
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := NOW();
BEGIN
  SELECT
    gt.customer_id,
    gt.event_booking_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.expires_at <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.event_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.seats,
    b.status
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_token.event_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.price_per_seat,
    e.price,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  RETURN jsonb_build_object(
    'state', 'ready',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'status', v_booking.status,
    'seats', COALESCE(v_booking.seats, 1),
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
    'can_cancel', (v_booking.status IN ('confirmed', 'pending_payment') AND v_event_start > v_now),
    'can_change_seats', (v_booking.status IN ('confirmed', 'pending_payment') AND v_event_start > v_now)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_booking_manage_preview_v05(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_booking_manage_preview_v05(text) TO service_role;

CREATE OR REPLACE FUNCTION public.update_event_booking_seats_v05(
  p_hashed_token text,
  p_new_seats integer,
  p_actor text DEFAULT 'guest'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := NOW();
  v_delta integer;
  v_capacity_snapshot RECORD;
BEGIN
  IF p_new_seats IS NULL OR p_new_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    gt.customer_id,
    gt.event_booking_id,
    gt.expires_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.expires_at <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.event_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.seats,
    b.status
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_token.event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.price_per_seat,
    e.price,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  v_delta := p_new_seats - COALESCE(v_booking.seats, 1);

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'state', 'unchanged',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_event.id,
      'event_name', v_event.name,
      'event_start_datetime', v_event_start,
      'status', v_booking.status,
      'payment_mode', COALESCE(v_event.payment_mode, 'free'),
      'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
      'old_seats', COALESCE(v_booking.seats, 1),
      'new_seats', COALESCE(v_booking.seats, 1),
      'delta', 0
    );
  END IF;

  IF v_delta > 0 THEN
    SELECT *
    INTO v_capacity_snapshot
    FROM public.get_event_capacity_snapshot_v05(ARRAY[v_event.id]::uuid[])
    LIMIT 1;

    IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < v_delta THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'requested_increase', v_delta
      );
    END IF;
  END IF;

  UPDATE public.bookings
  SET
    seats = p_new_seats,
    updated_at = v_now
  WHERE id = v_booking.id;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.booking_holds
    SET
      seats_or_covers_held = p_new_seats,
      updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'status', v_booking.status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
    'old_seats', COALESCE(v_booking.seats, 1),
    'new_seats', p_new_seats,
    'delta', v_delta,
    'actor', COALESCE(NULLIF(TRIM(p_actor), ''), 'guest')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_event_booking_v05(
  p_hashed_token text,
  p_cancelled_by text DEFAULT 'guest'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := NOW();
BEGIN
  SELECT
    gt.customer_id,
    gt.event_booking_id,
    gt.expires_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.expires_at <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.event_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.seats,
    b.status
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_token.event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('state', 'already_cancelled', 'booking_id', v_booking.id);
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_cancellable');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.price_per_seat,
    e.price,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  UPDATE public.bookings
  SET
    status = 'cancelled',
    cancelled_at = v_now,
    cancelled_by = COALESCE(NULLIF(TRIM(p_cancelled_by), ''), 'guest'),
    updated_at = v_now
  WHERE id = v_booking.id;

  UPDATE public.booking_holds
  SET
    status = 'released',
    released_at = v_now,
    updated_at = v_now
  WHERE event_booking_id = v_booking.id
    AND status = 'active';

  RETURN jsonb_build_object(
    'state', 'cancelled',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
    'seats', COALESCE(v_booking.seats, 1),
    'previous_status', v_booking.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_event_booking_v05(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_event_booking_v05(text, text) TO service_role;
