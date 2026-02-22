-- Sunday lunch table-booking deposits:
-- - replace card capture for Sunday lunch with mandatory GBP 10 per person payment holds
-- - add table payment confirmation/cash confirmation runtime helpers

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname
  INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.payments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%charge_type%'
  ORDER BY oid DESC
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.payments
    ADD CONSTRAINT payments_charge_type_check
    CHECK (charge_type IN (
      'prepaid_event',
      'seat_increase',
      'refund',
      'approved_fee',
      'walkout',
      'table_deposit'
    ));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL
     AND to_regprocedure('public.create_table_booking_v05_core_sunday_deposit_legacy(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    ALTER FUNCTION public.create_table_booking_v05_core(
      uuid,
      date,
      time without time zone,
      integer,
      text,
      text,
      boolean,
      text
    ) RENAME TO create_table_booking_v05_core_sunday_deposit_legacy;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_table_booking_v05_core(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food',
  p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_state text := 'blocked';
  v_table_booking_id uuid;
  v_booking RECORD;
  v_now timestamptz := NOW();
  v_party_size integer := GREATEST(1, COALESCE(p_party_size, 1));
  v_booking_start timestamptz;
  v_hold_expires_at timestamptz;
  v_deposit_amount numeric(10, 2);
  v_payment_id uuid;
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core_sunday_deposit_legacy(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  v_result := public.create_table_booking_v05_core_sunday_deposit_legacy(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );

  IF COALESCE(p_sunday_lunch, false) = false THEN
    RETURN v_result;
  END IF;

  v_state := COALESCE(v_result->>'state', 'blocked');
  IF v_state = 'blocked' THEN
    RETURN v_result;
  END IF;

  v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT
    tb.id,
    tb.status,
    tb.party_size,
    tb.committed_party_size,
    tb.booking_date,
    tb.booking_time,
    tb.start_datetime,
    tb.payment_method,
    tb.payment_status
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = v_table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  v_party_size := GREATEST(1, COALESCE(v_booking.committed_party_size, v_booking.party_size, p_party_size, 1));
  v_deposit_amount := ROUND((v_party_size::numeric) * 10.0, 2);
  v_booking_start := COALESCE(
    v_booking.start_datetime,
    ((v_booking.booking_date::text || ' ' || v_booking.booking_time::text)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_booking_start IS NULL OR v_booking_start <= v_now THEN
    v_hold_expires_at := v_now + INTERVAL '15 minutes';
  ELSE
    v_hold_expires_at := LEAST(v_booking_start, v_now + INTERVAL '24 hours');
  END IF;

  UPDATE public.booking_holds
  SET
    status = 'released',
    released_at = v_now,
    updated_at = v_now
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'card_capture_hold'
    AND status = 'active';

  UPDATE public.card_captures
  SET
    status = 'expired',
    expires_at = v_now,
    updated_at = v_now
  WHERE table_booking_id = v_table_booking_id
    AND status = 'pending';

  UPDATE public.booking_holds
  SET
    seats_or_covers_held = v_party_size,
    expires_at = v_hold_expires_at,
    updated_at = v_now,
    scheduled_sms_send_time = NULL,
    status = 'active',
    released_at = NULL,
    consumed_at = NULL
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'payment_hold'
    AND status = 'active';

  IF NOT FOUND THEN
    INSERT INTO public.booking_holds (
      hold_type,
      table_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_table_booking_id,
      v_party_size,
      'active',
      v_hold_expires_at,
      v_now,
      v_now
    );
  END IF;

  SELECT p.id
  INTO v_payment_id
  FROM public.payments p
  WHERE p.table_booking_id = v_table_booking_id
    AND p.charge_type = 'table_deposit'
    AND p.status IN ('pending', 'succeeded')
  ORDER BY p.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment_id IS NULL THEN
    INSERT INTO public.payments (
      table_booking_id,
      charge_type,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      v_table_booking_id,
      'table_deposit',
      v_deposit_amount,
      'GBP',
      'pending',
      jsonb_build_object(
        'source', 'table_booking_runtime',
        'deposit_per_person', 10,
        'party_size', v_party_size,
        'created_at', v_now
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  ELSE
    UPDATE public.payments
    SET
      amount = v_deposit_amount,
      currency = 'GBP',
      status = CASE WHEN status = 'succeeded' THEN status ELSE 'pending' END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'table_booking_runtime',
        'deposit_per_person', 10,
        'party_size', v_party_size,
        'updated_at', v_now
      )
    WHERE id = v_payment_id;
  END IF;

  UPDATE public.table_bookings
  SET
    status = 'pending_payment'::public.table_booking_status,
    confirmed_at = NULL,
    hold_expires_at = v_hold_expires_at,
    card_capture_required = false,
    payment_method = 'payment_link'::public.table_booking_payment_method,
    payment_status = 'pending'::public.payment_status,
    updated_at = v_now
  WHERE id = v_table_booking_id;

  RETURN v_result || jsonb_build_object(
    'state', 'pending_payment',
    'status', 'pending_payment',
    'hold_expires_at', v_hold_expires_at,
    'card_capture_required', false,
    'payment_required', true,
    'deposit_per_person', 10,
    'deposit_amount', v_deposit_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;

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

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.table_bookings
    SET
      status = 'confirmed'::public.table_booking_status,
      confirmed_at = COALESCE(confirmed_at, v_now),
      hold_expires_at = NULL,
      payment_status = 'completed'::public.payment_status,
      payment_method = COALESCE(payment_method, 'payment_link'::public.table_booking_payment_method),
      updated_at = v_now
    WHERE id = p_table_booking_id;

    UPDATE public.booking_holds
    SET
      status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
    WHERE table_booking_id = p_table_booking_id
      AND hold_type = 'payment_hold'
      AND status = 'active';

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

  IF v_booking.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'state', 'already_confirmed',
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

CREATE OR REPLACE FUNCTION public.record_table_cash_deposit_v05(
  p_table_booking_id uuid,
  p_amount numeric DEFAULT NULL,
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

  UPDATE public.payments
  SET
    status = 'succeeded',
    amount = COALESCE(v_amount, amount),
    currency = COALESCE(NULLIF(TRIM(COALESCE(p_currency, '')), ''), currency),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmed_at', v_now,
      'source', 'foh_cash',
      'deposit_per_person', 10,
      'party_size', v_party_size
    )
  WHERE table_booking_id = p_table_booking_id
    AND charge_type = 'table_deposit'
    AND status = 'pending'
  RETURNING id INTO v_payment_id;

  IF NOT FOUND THEN
    INSERT INTO public.payments (
      table_booking_id,
      charge_type,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      p_table_booking_id,
      'table_deposit',
      COALESCE(v_amount, v_expected_amount),
      COALESCE(NULLIF(TRIM(COALESCE(p_currency, '')), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'confirmed_at', v_now,
        'source', 'foh_cash',
        'deposit_per_person', 10,
        'party_size', v_party_size
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  END IF;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.table_bookings
    SET
      status = 'confirmed'::public.table_booking_status,
      confirmed_at = COALESCE(confirmed_at, v_now),
      hold_expires_at = NULL,
      payment_method = 'cash'::public.table_booking_payment_method,
      payment_status = 'completed'::public.payment_status,
      updated_at = v_now
    WHERE id = p_table_booking_id;

    UPDATE public.booking_holds
    SET
      status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
    WHERE table_booking_id = p_table_booking_id
      AND hold_type = 'payment_hold'
      AND status = 'active';

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

  IF v_booking.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'state', 'already_confirmed',
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

REVOKE ALL ON FUNCTION public.record_table_cash_deposit_v05(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_table_cash_deposit_v05(uuid, numeric, text) TO service_role;
