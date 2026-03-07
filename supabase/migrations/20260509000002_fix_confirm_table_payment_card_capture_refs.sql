-- Fix confirm_table_payment_v05: remove references to dropped card capture infrastructure.
-- Migration 20260508000007 dropped:
--   - card_captures table
--   - card_capture_required column on table_bookings
--   - card_capture_hold type from booking_holds constraint
-- But confirm_table_payment_v05 (from 20260507000002) still references all three,
-- causing the Stripe webhook to fail with a DB error on every deposit payment confirmation.

CREATE OR REPLACE FUNCTION public.confirm_table_payment_v05(
  p_table_booking_id uuid,
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
  v_payment_id uuid;
  v_now timestamptz := NOW();
  v_party_size integer := 1;
  v_expected_amount numeric(10, 2) := 10.00;
  v_amount numeric(10, 2);
BEGIN
  SELECT
    tb.id,
    tb.customer_id,
    tb.status,
    tb.party_size,
    tb.committed_party_size,
    tb.booking_reference,
    tb.booking_type
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = p_table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_not_found'
    );
  END IF;

  v_party_size := GREATEST(1, COALESCE(v_booking.committed_party_size, v_booking.party_size, 1));
  v_expected_amount := ROUND((v_party_size::numeric) * 10.0, 2);
  v_amount := COALESCE(p_amount, v_expected_amount);

  -- Update or insert the payments row regardless of booking status.
  UPDATE public.payments
  SET
    status = 'succeeded',
    stripe_payment_intent_id = COALESCE(NULLIF(TRIM(COALESCE(p_payment_intent_id, '')), ''), stripe_payment_intent_id),
    amount = COALESCE(v_amount, amount),
    currency = COALESCE(NULLIF(TRIM(COALESCE(p_currency, '')), ''), currency),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmed_at', v_now,
      'checkout_session_id', p_checkout_session_id,
      'source', 'stripe_webhook',
      'deposit_per_person', 10,
      'party_size', v_party_size
    )
  WHERE table_booking_id = p_table_booking_id
    AND charge_type = 'table_deposit'
    AND stripe_checkout_session_id = p_checkout_session_id
  RETURNING id INTO v_payment_id;

  IF NOT FOUND THEN
    INSERT INTO public.payments (
      table_booking_id,
      charge_type,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      p_table_booking_id,
      'table_deposit',
      NULLIF(TRIM(COALESCE(p_payment_intent_id, '')), ''),
      NULLIF(TRIM(COALESCE(p_checkout_session_id, '')), ''),
      COALESCE(v_amount, v_expected_amount),
      COALESCE(NULLIF(TRIM(COALESCE(p_currency, '')), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'confirmed_at', v_now,
        'source', 'stripe_webhook',
        'deposit_per_person', 10,
        'party_size', v_party_size
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  END IF;

  -- Booking was awaiting payment — transition it to confirmed.
  IF v_booking.status IN ('pending_payment', 'pending_card_capture') THEN
    UPDATE public.table_bookings
    SET
      status = 'confirmed'::public.table_booking_status,
      confirmed_at = COALESCE(confirmed_at, v_now),
      hold_expires_at = NULL,
      payment_status = 'completed'::public.payment_status,
      payment_method = COALESCE(payment_method, 'payment_link'::public.table_booking_payment_method),
      updated_at = v_now
    WHERE id = p_table_booking_id;

    -- Consume any payment holds.
    UPDATE public.booking_holds
    SET
      status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
    WHERE table_booking_id = p_table_booking_id
      AND hold_type = 'payment_hold'
      AND status = 'active';

    -- Consume the guest payment token so the link cannot be reused.
    UPDATE public.guest_tokens
    SET consumed_at = v_now
    WHERE table_booking_id = p_table_booking_id
      AND action_type = 'payment'
      AND consumed_at IS NULL;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', p_table_booking_id,
      'customer_id', v_booking.customer_id,
      'booking_reference', v_booking.booking_reference,
      'party_size', v_party_size,
      'payment_id', v_payment_id
    );
  END IF;

  -- Booking was already confirmed (e.g. manager-created) — update
  -- payment_status and consume the guest token so the deposit link
  -- disappears and the confirmation SMS fires.
  IF v_booking.status = 'confirmed' THEN
    UPDATE public.table_bookings
    SET
      payment_status = 'completed'::public.payment_status,
      payment_method = COALESCE(payment_method, 'payment_link'::public.table_booking_payment_method),
      updated_at = v_now
    WHERE id = p_table_booking_id;

    UPDATE public.guest_tokens
    SET consumed_at = v_now
    WHERE table_booking_id = p_table_booking_id
      AND action_type = 'payment'
      AND consumed_at IS NULL;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', p_table_booking_id,
      'customer_id', v_booking.customer_id,
      'booking_reference', v_booking.booking_reference,
      'party_size', v_party_size,
      'payment_id', v_payment_id
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'blocked',
    'reason', 'booking_not_pending_payment',
    'table_booking_id', p_table_booking_id,
    'payment_id', v_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_table_payment_v05(uuid, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_table_payment_v05(uuid, text, text, numeric, text) TO service_role;
