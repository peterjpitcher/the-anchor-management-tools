-- D09: Payment vs Hold Expiry Race Condition Fix
-- When the hold-expiry cron expires a booking moments before a Stripe webhook
-- confirms payment, the RPC previously hard-rejected with 'booking_not_pending_payment'.
-- This update adds recovery logic for recently-expired bookings with a capacity check.

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
  v_table_result jsonb := NULL;
  v_table_state text := NULL;
  v_table_reason text := NULL;
  v_capacity_snapshot RECORD;
BEGIN
  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.status,
    b.seats,
    b.expired_at
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

  SELECT e.id, e.name, e.booking_mode
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

    -- Ensure table reservation exists (or is confirmed) for non-general entry events.
    IF COALESCE(v_event.booking_mode, 'table') <> 'general' THEN
      BEGIN
        v_table_result := public.create_event_table_reservation_v05(
          v_booking.event_id,
          v_booking.id,
          v_booking.customer_id,
          COALESCE(v_booking.seats, 1),
          'stripe_webhook',
          'Payment confirmed'
        );
        v_table_state := COALESCE(v_table_result->>'state', NULL);
        v_table_reason := COALESCE(v_table_result->>'reason', NULL);
      EXCEPTION
        WHEN OTHERS THEN
          v_table_state := 'blocked';
          v_table_reason := 'no_table';
      END;
    END IF;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason,
      'table_booking_id', COALESCE(v_table_result->>'table_booking_id', NULL)
    );
  END IF;

  IF v_booking.status = 'confirmed' THEN
    IF COALESCE(v_event.booking_mode, 'table') <> 'general' THEN
      BEGIN
        v_table_result := public.create_event_table_reservation_v05(
          v_booking.event_id,
          v_booking.id,
          v_booking.customer_id,
          COALESCE(v_booking.seats, 1),
          'stripe_webhook',
          'Payment confirmed (replay)'
        );
        v_table_state := COALESCE(v_table_result->>'state', NULL);
        v_table_reason := COALESCE(v_table_result->>'reason', NULL);
      EXCEPTION
        WHEN OTHERS THEN
          v_table_state := 'blocked';
          v_table_reason := 'no_table';
      END;
    END IF;

    RETURN jsonb_build_object(
      'state', 'already_confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason,
      'table_booking_id', COALESCE(v_table_result->>'table_booking_id', NULL)
    );
  END IF;

  -- D09: Recovery for recently-expired bookings (race condition fix)
  -- The hold-expiry cron writes expired_at (NOT cancelled_at).
  -- If payment arrives within 10 minutes of expiry, attempt recovery.
  IF v_booking.status = 'expired' THEN
    -- Only recover if expired within the last 10 minutes
    IF v_booking.expired_at IS NULL OR v_booking.expired_at < v_now - INTERVAL '10 minutes' THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'booking_expired_too_long_ago',
        'booking_id', v_booking.id,
        'payment_id', v_payment_id
      );
    END IF;

    -- Capacity check: verify seats are still available before recovering
    SELECT *
    INTO v_capacity_snapshot
    FROM public.get_event_capacity_snapshot_v05(ARRAY[v_booking.event_id]::uuid[])
    LIMIT 1;

    IF v_capacity_snapshot.capacity IS NOT NULL
       AND v_capacity_snapshot.seats_remaining < COALESCE(v_booking.seats, 1)
    THEN
      -- No capacity: cannot recover — signal auto-refund needed
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'capacity_exceeded_after_expiry',
        'action', 'auto_refund',
        'booking_id', v_booking.id,
        'payment_id', v_payment_id
      );
    END IF;

    -- Recovery: set back to pending_payment then continue with confirmation
    UPDATE public.bookings
    SET status = 'pending_payment', expired_at = NULL, updated_at = v_now
    WHERE id = v_booking.id;

    -- Re-activate the booking hold (if one was expired by the cron)
    UPDATE public.booking_holds
    SET
      status = 'active',
      released_at = NULL,
      updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'expired';

    -- Now confirm the booking (same logic as pending_payment path above)
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

    -- Ensure table reservation for non-general entry events
    IF COALESCE(v_event.booking_mode, 'table') <> 'general' THEN
      BEGIN
        v_table_result := public.create_event_table_reservation_v05(
          v_booking.event_id,
          v_booking.id,
          v_booking.customer_id,
          COALESCE(v_booking.seats, 1),
          'stripe_webhook',
          'Payment confirmed (recovered from expiry)'
        );
        v_table_state := COALESCE(v_table_result->>'state', NULL);
        v_table_reason := COALESCE(v_table_result->>'reason', NULL);
      EXCEPTION
        WHEN OTHERS THEN
          v_table_state := 'blocked';
          v_table_reason := 'no_table';
      END;
    END IF;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'recovered_from_expiry', true,
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason,
      'table_booking_id', COALESCE(v_table_result->>'table_booking_id', NULL)
    );
  END IF;

  -- Fallback: booking is in an unexpected status (cancelled, etc.)
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
