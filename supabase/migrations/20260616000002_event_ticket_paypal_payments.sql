-- Event ticket PayPal payment foundations.
-- Forward-only migration: keep shared Stripe columns/code for non-event flows.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paypal_order_id text,
  ADD COLUMN IF NOT EXISTS paypal_capture_id text;

UPDATE public.payments
SET
  payment_provider = 'stripe',
  payment_method = 'stripe'
WHERE payment_provider IS NULL
  AND (
    stripe_payment_intent_id IS NOT NULL
    OR stripe_checkout_session_id IS NOT NULL
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_payment_provider_check'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_payment_provider_check
      CHECK (payment_provider IS NULL OR payment_provider IN ('paypal', 'manual', 'stripe')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_payment_method_check'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('paypal', 'cash', 'card_terminal', 'comp', 'stripe')) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_paypal_order_id_unique
  ON public.payments (paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_paypal_capture_id_unique
  ON public.payments (paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_event_provider_status_idx
  ON public.payments (event_booking_id, payment_provider, status)
  WHERE event_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_payment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN (
    'capacity_unavailable_after_capture',
    'table_unavailable_after_capture',
    'booking_expired_after_capture',
    'confirmation_failed_after_capture',
    'manual_refund_required'
  )),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolution text CHECK (resolution IS NULL OR resolution IN ('confirmed', 'refunded', 'transferred', 'cancelled')),
  customer_notified_at timestamptz,
  staff_notified_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_payment_exceptions_open_booking_reason_idx
  ON public.event_payment_exceptions (event_booking_id, reason)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.event_payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('payment_due_12h', 'payment_due_2h', 'payment_manual_review')),
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_booking_id, stage, channel)
);

CREATE TABLE IF NOT EXISTS public.event_ticket_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  new_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  from_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  to_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
  requested_by text NOT NULL DEFAULT 'staff',
  approved_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS event_ticket_transfers_once_per_original_idx
  ON public.event_ticket_transfers (original_booking_id)
  WHERE status IN ('pending', 'completed');

CREATE OR REPLACE FUNCTION public.create_event_booking_v06(
  p_event_id uuid,
  p_customer_id uuid,
  p_seats integer,
  p_source text DEFAULT 'brand_site',
  p_seating_preference text DEFAULT 'seated',
  p_payment_hold_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_booking_id uuid;
  v_event_start timestamptz;
  v_hold_expires_at timestamptz;
  v_minutes integer;
BEGIN
  v_result := public.create_event_booking_v05(
    p_event_id,
    p_customer_id,
    p_seats,
    p_source,
    p_seating_preference
  );

  IF COALESCE(v_result->>'state', '') <> 'pending_payment' THEN
    RETURN v_result;
  END IF;

  v_booking_id := NULLIF(v_result->>'booking_id', '')::uuid;
  v_minutes := GREATEST(1, COALESCE(p_payment_hold_minutes, 24 * 60));

  SELECT COALESCE(
    e.start_datetime,
    CASE
      WHEN e.date IS NOT NULL AND e.time IS NOT NULL
        THEN ((e.date::text || ' ' || e.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  )
  INTO v_event_start
  FROM public.events e
  WHERE e.id = p_event_id;

  v_hold_expires_at := LEAST(
    COALESCE(v_event_start, now() + make_interval(mins => v_minutes)),
    now() + make_interval(mins => v_minutes)
  );

  UPDATE public.bookings
  SET hold_expires_at = v_hold_expires_at, updated_at = now()
  WHERE id = v_booking_id
    AND status = 'pending_payment';

  UPDATE public.booking_holds
  SET expires_at = v_hold_expires_at, updated_at = now()
  WHERE event_booking_id = v_booking_id
    AND hold_type = 'payment_hold'
    AND status = 'active';

  RETURN jsonb_set(v_result, '{hold_expires_at}', to_jsonb(v_hold_expires_at), true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_booking_v06(uuid, uuid, integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v06(uuid, uuid, integer, text, text, integer) TO service_role;

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
BEGIN
  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.status,
    b.seats,
    b.expired_at,
    b.hold_expires_at
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
    IF COALESCE(v_event.booking_mode, 'table') <> 'general' THEN
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

REVOKE ALL ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_event_manual_payment_v01(
  p_event_booking_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_currency text DEFAULT 'GBP',
  p_performed_by uuid DEFAULT NULL,
  p_note text DEFAULT NULL
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
  v_method text := NULLIF(TRIM(p_payment_method), '');
  v_table_result jsonb := NULL;
  v_table_state text := NULL;
  v_table_reason text := NULL;
  v_exception_reason text := NULL;
BEGIN
  IF v_method IS NULL OR v_method NOT IN ('cash', 'card_terminal', 'comp') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_payment_method');
  END IF;

  IF v_method <> 'comp' AND COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_amount');
  END IF;

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

  SELECT e.id, e.name, e.booking_mode
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  IF v_booking.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'state', 'already_confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1)
    );
  END IF;

  IF v_booking.status <> 'pending_payment' THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'booking_not_pending_payment',
      'booking_id', v_booking.id
    );
  END IF;

  IF v_booking.hold_expires_at IS NOT NULL
     AND v_booking.hold_expires_at < v_now - INTERVAL '10 minutes' THEN
    v_exception_reason := 'booking_expired_after_capture';
  END IF;

  INSERT INTO public.payments (
    event_booking_id,
    charge_type,
    payment_provider,
    payment_method,
    amount,
    currency,
    status,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    'prepaid_event',
    'manual',
    v_method,
    CASE WHEN v_method = 'comp' THEN 0 ELSE COALESCE(p_amount, 0) END,
    COALESCE(NULLIF(TRIM(p_currency), ''), 'GBP'),
    'succeeded',
    jsonb_build_object(
      'confirmed_at', v_now,
      'source', 'manual_mark_paid',
      'performed_by', p_performed_by,
      'note', p_note
    ),
    v_now,
    v_now
  )
  RETURNING id INTO v_payment_id;

  IF v_exception_reason IS NULL AND COALESCE(v_event.booking_mode, 'table') <> 'general' THEN
    BEGIN
      v_table_result := public.create_event_table_reservation_v05(
        v_booking.event_id,
        v_booking.id,
        v_booking.customer_id,
        COALESCE(v_booking.seats, 1),
        'manual_payment',
        'Manual payment confirmed'
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
        'payment_method', v_method,
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
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_event_manual_payment_v01(uuid, text, numeric, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_event_manual_payment_v01(uuid, text, numeric, text, uuid, text) TO service_role;
