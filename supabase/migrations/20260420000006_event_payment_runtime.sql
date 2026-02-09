-- v0.5 event payment runtime confirmation helpers

CREATE OR REPLACE FUNCTION public.confirm_event_payment_v05(
  p_event_booking_id uuid,
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
  v_payment_id uuid;
  v_now timestamptz := NOW();
BEGIN
  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.status,
    b.seats
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_not_found'
    );
  END IF;

  SELECT e.id, e.name
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  UPDATE public.payments
  SET
    status = 'succeeded',
    stripe_payment_intent_id = COALESCE(NULLIF(TRIM(p_payment_intent_id), ''), stripe_payment_intent_id),
    amount = COALESCE(p_amount, amount),
    currency = COALESCE(NULLIF(TRIM(p_currency), ''), currency),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmed_at', v_now,
      'checkout_session_id', p_checkout_session_id
    )
  WHERE event_booking_id = p_event_booking_id
    AND charge_type = 'prepaid_event'
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
      'prepaid_event',
      NULLIF(TRIM(p_payment_intent_id), ''),
      p_checkout_session_id,
      COALESCE(p_amount, 0),
      COALESCE(NULLIF(TRIM(p_currency), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'confirmed_at', v_now,
        'source', 'stripe_webhook'
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  END IF;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_booking.id;

    UPDATE public.booking_holds
    SET
      status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';

    UPDATE public.guest_tokens
    SET consumed_at = v_now
    WHERE event_booking_id = v_booking.id
      AND action_type = 'payment'
      AND consumed_at IS NULL;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id
    );
  END IF;

  IF v_booking.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'state', 'already_confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'blocked',
    'reason', 'booking_not_pending_payment',
    'booking_id', v_booking.id,
    'payment_id', v_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_event_payment_v05(uuid, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_event_payment_v05(uuid, text, text, numeric, text) TO service_role;
