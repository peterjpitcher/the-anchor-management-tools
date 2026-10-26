-- A late PayPal payment for a 'general' event can no longer confirm seats already sold to
-- someone else (BK-020, customer bookings review of 24 October 2026).
--
-- A website hold lasts 15 minutes and PayPal can still be captured for 10 minutes after it
-- lapses (EVENT_PAYMENT_GRACE_WINDOW_MS). Once a hold lapses its seats stop counting
-- (is_active_event_booking_for_capacity_v01 counts a pending_payment booking only while
-- hold_expires_at > now()), so another guest can take them; confirm_event_paypal_payment_v01
-- then confirmed the late payment with no capacity check. Shared-seating events were fixed by
-- 20261026135338_event_payment_confirm_communal_seats and table events reserve a table at
-- payment, which fails when the tables have gone; 'general' events had no check at all.
--
-- Now, for a 'general' event (and any mode other than table, mixed and communal), the
-- function locks the event row, as the other modes do, and when the payment hold has lapsed
-- by the clock it checks the event's remaining places (get_event_capacity_snapshot_v05,
-- adding back this booking's own seats if the snapshot still counts them). If the booking no
-- longer fits, the money is recorded and the booking goes to manual review as
-- capacity_unavailable_after_capture (an existing reason), exactly as for shared seating.
-- An event with no limit is never full. A live hold confirms as before. A deadlock with
-- another booking is retried up to three times.
--
-- Only confirm_event_paypal_payment_v01 changes. Its body is production's text (md5(prosrc)
-- d9a7c35bd0d76e8b31c6e431cfc194ea on 26 October 2026, the same as
-- 20261026135338_event_payment_confirm_communal_seats) with only the branch above added.
-- Signature, return shape, SECURITY DEFINER, search_path and grants are unchanged, so no
-- generated types change and the deployed app needs no change.
-- Rollback: tasks/event-late-payment-capacity/rollback.sql.
-- Tested by scripts/testing/event-late-payment-capacity-postgres.py.

CREATE OR REPLACE FUNCTION public.confirm_event_paypal_payment_v01(
  p_event_booking_id uuid,
  p_paypal_order_id text,
  p_paypal_capture_id text,
  p_amount numeric,
  p_currency text DEFAULT 'GBP',
  p_source text DEFAULT 'paypal_capture'
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
  v_now timestamptz := now();
  v_table_result jsonb := NULL;
  v_table_state text := NULL;
  v_table_reason text := NULL;
  v_exception_reason text := NULL;
  v_event_status text;
  v_capacity RECORD;
  v_own_seats integer;
BEGIN
  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.status,
    b.seats,
    b.expired_at,
    b.hold_expires_at,
    b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT e.id, e.name, e.booking_mode
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  UPDATE public.payments
  SET
    status = 'succeeded',
    payment_provider = 'paypal',
    payment_method = 'paypal',
    paypal_order_id = COALESCE(NULLIF(TRIM(p_paypal_order_id), ''), paypal_order_id),
    paypal_capture_id = COALESCE(NULLIF(TRIM(p_paypal_capture_id), ''), paypal_capture_id),
    amount = COALESCE(p_amount, amount),
    currency = COALESCE(NULLIF(TRIM(p_currency), ''), currency),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmed_at', v_now,
      'source', COALESCE(NULLIF(TRIM(p_source), ''), 'paypal_capture')
    ),
    updated_at = v_now
  WHERE event_booking_id = p_event_booking_id
    AND charge_type = 'prepaid_event'
    AND (
      paypal_capture_id = NULLIF(TRIM(p_paypal_capture_id), '')
      OR paypal_order_id = NULLIF(TRIM(p_paypal_order_id), '')
    )
  RETURNING id INTO v_payment_id;

  IF NOT FOUND THEN
    INSERT INTO public.payments (
      event_booking_id,
      charge_type,
      payment_provider,
      payment_method,
      paypal_order_id,
      paypal_capture_id,
      amount,
      currency,
      status,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      p_event_booking_id,
      'prepaid_event',
      'paypal',
      'paypal',
      NULLIF(TRIM(p_paypal_order_id), ''),
      NULLIF(TRIM(p_paypal_capture_id), ''),
      COALESCE(p_amount, 0),
      COALESCE(NULLIF(TRIM(p_currency), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'confirmed_at', v_now,
        'source', COALESCE(NULLIF(TRIM(p_source), ''), 'paypal_capture')
      ),
      v_now,
      v_now
    )
    RETURNING id INTO v_payment_id;
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

  IF v_booking.status = 'expired' THEN
    IF v_booking.expired_at IS NULL OR v_booking.expired_at < v_now - INTERVAL '10 minutes' THEN
      v_exception_reason := 'booking_expired_after_capture';
    ELSE
      UPDATE public.bookings
      SET status = 'pending_payment', expired_at = NULL, updated_at = v_now
      WHERE id = v_booking.id;
      v_booking.status := 'pending_payment';
    END IF;
  END IF;

  IF v_booking.status = 'pending_payment'
     AND v_booking.hold_expires_at IS NOT NULL
     AND v_booking.hold_expires_at < v_now - INTERVAL '10 minutes' THEN
    v_exception_reason := 'booking_expired_after_capture';
  END IF;

  IF v_exception_reason IS NULL AND v_booking.status = 'pending_payment' THEN
    IF COALESCE(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
      BEGIN
        v_table_result := public.create_event_table_reservation_v05(
          v_booking.event_id,
          v_booking.id,
          v_booking.customer_id,
          COALESCE(v_booking.seats, 1),
          'paypal_capture',
          'Payment confirmed'
        );
        v_table_state := COALESCE(v_table_result->>'state', NULL);
        v_table_reason := COALESCE(v_table_result->>'reason', NULL);
        IF v_table_state IS NOT NULL AND v_table_state <> 'confirmed' THEN
          v_exception_reason := 'table_unavailable_after_capture';
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          v_exception_reason := 'table_unavailable_after_capture';
          v_table_state := 'blocked';
          v_table_reason := 'no_table';
      END;
    ELSIF v_event.booking_mode = 'communal' THEN
      -- Shared seating holds seats, never a whole table. Lock the event row (as
      -- the table step did, so other bookings and seat changes for this event wait)
      -- and, for seated guests, every table in the order
      -- allocate_event_communal_seats_v01 takes them, so nothing can claim these
      -- seats while the payment is decided. A cancelled or draft event goes to
      -- review, as the table step sent it. Then judge the hold by the clock, not the
      -- transaction start: seats under a live hold counted against capacity all
      -- along, but once it lapses another guest may have taken them, so the event's
      -- limits and the physical seats are checked again. If Postgres cancels this
      -- check to break a deadlock with another booking (a joined-table booking can
      -- lock tables in a different order), the other side finishes and the check
      -- is retried rather than sending a paid booking to review.
      FOR v_attempt IN 1..3 LOOP
        v_exception_reason := NULL;
        v_table_result := NULL;
        v_table_state := NULL;
        v_table_reason := NULL;
        BEGIN
          SELECT e.event_status
          INTO v_event_status
          FROM public.events e
          WHERE e.id = v_booking.event_id
          FOR UPDATE;

          IF COALESCE(v_event_status, 'scheduled') IN ('cancelled', 'draft') THEN
            v_exception_reason := 'capacity_unavailable_after_capture';
            v_table_state := 'blocked';
            v_table_reason := 'not_bookable';
          ELSE
            IF v_booking.event_seating_type = 'seated' THEN
              PERFORM 1
              FROM public.tables t
              WHERE (COALESCE(t.is_bookable, true) AND t.capacity > 0)
                OR t.id IN (
                  SELECT a.table_id
                  FROM public.event_communal_seat_allocations a
                  WHERE a.event_booking_id = v_booking.id
                )
              ORDER BY t.bar_priority ASC, t.capacity ASC,
                COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999), t.id
              FOR UPDATE OF t;
            END IF;

            IF v_booking.hold_expires_at <= clock_timestamp()
              OR (
                v_booking.event_seating_type = 'seated'
                AND COALESCE((
                  SELECT SUM(a.seats)
                  FROM public.event_communal_seat_allocations a
                  WHERE a.event_booking_id = v_booking.id
                ), 0) <> COALESCE(v_booking.seats, 1)
              ) THEN
              SELECT s.seated_remaining, s.standing_remaining, s.total_remaining
              INTO v_capacity
              FROM public.get_event_capacity_snapshot_v05(ARRAY[v_booking.event_id]) s;

              -- The snapshot judges holds by the transaction start, so it may still
              -- count this booking; add its own seats back in that case.
              v_own_seats := CASE
                WHEN public.is_active_event_booking_for_capacity_v01(v_booking.status, v_booking.hold_expires_at)
                  THEN COALESCE(v_booking.seats, 1)
                ELSE 0
              END;

              IF COALESCE(LEAST(
                   CASE WHEN v_booking.event_seating_type = 'standing'
                     THEN v_capacity.standing_remaining
                     ELSE v_capacity.seated_remaining
                   END,
                   v_capacity.total_remaining
                 ), 0) + v_own_seats < COALESCE(v_booking.seats, 1) THEN
                v_exception_reason := 'capacity_unavailable_after_capture';
                v_table_state := 'blocked';
                v_table_reason := 'event_full';
              ELSIF v_booking.event_seating_type = 'seated' THEN
                v_table_result := public.reallocate_event_communal_booking_v01(
                  v_booking.id,
                  COALESCE(v_booking.seats, 1)
                );
                v_table_state := COALESCE(v_table_result->>'state', 'blocked');
                v_table_reason := COALESCE(v_table_result->>'reason', NULL);
                IF v_table_state <> 'confirmed' THEN
                  v_exception_reason := 'capacity_unavailable_after_capture';
                END IF;
              END IF;
            END IF;
          END IF;
          EXIT;
        EXCEPTION
          WHEN deadlock_detected OR lock_not_available THEN
            IF v_attempt = 3 THEN
              v_exception_reason := 'capacity_unavailable_after_capture';
              v_table_state := 'blocked';
              v_table_reason := 'seat_check_' || SQLSTATE;
            END IF;
          WHEN OTHERS THEN
            v_exception_reason := 'capacity_unavailable_after_capture';
            v_table_state := 'blocked';
            v_table_reason := 'seat_check_' || SQLSTATE;
            EXIT;
        END;
      END LOOP;
    ELSE
      -- 'general' events (and any other mode) place no table and no seats, only the event's
      -- own limit. Lock the event row, as the table and shared-seating steps do, so a booking
      -- for this event waits while the payment is decided. Seats under a live hold counted
      -- against the limit all along; once the hold has lapsed by the clock another guest may
      -- have taken them, so the limit is checked again and a payment that no longer fits goes
      -- to manual review as capacity_unavailable_after_capture (BK-020). A deadlock with
      -- another booking is retried rather than sending a paid booking to review.
      FOR v_attempt IN 1..3 LOOP
        v_exception_reason := NULL;
        v_table_state := NULL;
        v_table_reason := NULL;
        BEGIN
          PERFORM 1
          FROM public.events e
          WHERE e.id = v_booking.event_id
          FOR UPDATE;

          IF v_booking.hold_expires_at IS NOT NULL
             AND v_booking.hold_expires_at <= clock_timestamp() THEN
            SELECT s.total_remaining
            INTO v_capacity
            FROM public.get_event_capacity_snapshot_v05(ARRAY[v_booking.event_id]) s;

            -- The snapshot judges holds by the transaction start, so it may still
            -- count this booking; add its own seats back in that case.
            v_own_seats := CASE
              WHEN public.is_active_event_booking_for_capacity_v01(v_booking.status, v_booking.hold_expires_at)
                THEN COALESCE(v_booking.seats, 1)
              ELSE 0
            END;

            -- No limit (NULL) means the event cannot fill.
            IF v_capacity.total_remaining IS NOT NULL
               AND v_capacity.total_remaining + v_own_seats < COALESCE(v_booking.seats, 1) THEN
              v_exception_reason := 'capacity_unavailable_after_capture';
              v_table_state := 'blocked';
              v_table_reason := 'event_full';
            END IF;
          END IF;
          EXIT;
        EXCEPTION
          WHEN deadlock_detected OR lock_not_available THEN
            IF v_attempt = 3 THEN
              v_exception_reason := 'capacity_unavailable_after_capture';
              v_table_state := 'blocked';
              v_table_reason := 'seat_check_' || SQLSTATE;
            END IF;
          WHEN OTHERS THEN
            v_exception_reason := 'capacity_unavailable_after_capture';
            v_table_state := 'blocked';
            v_table_reason := 'seat_check_' || SQLSTATE;
            EXIT;
        END;
      END LOOP;
    END IF;
  END IF;

  IF v_exception_reason IS NOT NULL THEN
    INSERT INTO public.event_payment_exceptions (
      event_booking_id,
      payment_id,
      reason,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_payment_id,
      v_exception_reason,
      jsonb_build_object(
        'paypal_order_id', NULLIF(TRIM(p_paypal_order_id), ''),
        'paypal_capture_id', NULLIF(TRIM(p_paypal_capture_id), ''),
        'amount', p_amount,
        'currency', p_currency,
        'table_state', v_table_state,
        'table_reason', v_table_reason
      ),
      v_now,
      v_now
    )
    ON CONFLICT (event_booking_id, reason) WHERE status = 'open'
    DO UPDATE SET
      payment_id = EXCLUDED.payment_id,
      metadata = public.event_payment_exceptions.metadata || EXCLUDED.metadata,
      updated_at = v_now;

    RETURN jsonb_build_object(
      'state', 'manual_review',
      'reason', v_exception_reason,
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason
    );
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
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason,
      'table_booking_id', COALESCE(v_table_result->>'table_booking_id', NULL)
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

REVOKE ALL ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) TO service_role;
