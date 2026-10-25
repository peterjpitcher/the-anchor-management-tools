-- Rollback for 20261025034143_event_payment_confirm_communal_seats.sql.
-- Restores the three functions exactly as production held them before it (bodies from
-- 20260616000002_event_ticket_paypal_payments and 20260921074304_event_physical_capacity).

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

REVOKE ALL ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
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

REVOKE ALL ON FUNCTION public.confirm_event_manual_payment_v01(uuid, text, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_manual_payment_v01(uuid, text, numeric, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_event_table_reservation_v05(p_event_id uuid, p_event_booking_id uuid, p_customer_id uuid, p_party_size integer, p_source text DEFAULT 'admin'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_full_candidate record;
  v_event RECORD;
  v_booking RECORD;

  v_event_start timestamptz;
  v_event_end timestamptz;
  v_reservation_start timestamptz;
  v_reservation_start_local timestamp without time zone;
  v_reservation_date date;
  v_reservation_time time without time zone;

  v_table_result jsonb := '{}'::jsonb;
  v_table_state text;
  v_table_booking_id uuid;

  v_current_assignment_end timestamptz;
  v_conflict_exists boolean := false;

  v_duration_minutes integer;
  v_booking_reference text;
  v_table_names text[];
  v_table_ids uuid[];

  v_note_text text;
  v_source text := COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'admin');

  v_target_status public.table_booking_status;
  v_target_hold_expires_at timestamptz;
BEGIN
  IF p_event_id IS NULL
     OR p_event_booking_id IS NULL
     OR p_customer_id IS NULL
     OR p_party_size IS NULL
     OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_request');
  END IF;

  IF p_party_size > 20 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  SELECT
    b.id, b.customer_id, b.event_id, b.status, b.seats, b.hold_expires_at
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.event_id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_mismatch');
  END IF;

  IF v_booking.customer_id IS DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_mismatch');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_active');
  END IF;

  SELECT
    e.id, e.name, e.booking_mode, e.booking_open, e.event_status,
    e.start_datetime, e.date, e.time, e.end_time, e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'general' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_general_entry_only');
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

  IF v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
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

  v_reservation_start := v_event_start - INTERVAL '15 minutes';
  IF v_reservation_start <= NOW() THEN
    v_reservation_start := v_event_start;
  END IF;

  v_reservation_start_local := v_reservation_start AT TIME ZONE 'Europe/London';
  v_reservation_date := v_reservation_start_local::date;
  v_reservation_time := v_reservation_start_local::time without time zone;

  v_note_text := concat_ws(
    ' · ',
    CASE WHEN COALESCE(v_event.name, '') = '' THEN NULL ELSE 'Event: ' || v_event.name END,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  IF v_booking.status = 'pending_payment' THEN
    v_target_status := 'pending_payment'::public.table_booking_status;
    v_target_hold_expires_at := v_booking.hold_expires_at;
  ELSE
    v_target_status := 'confirmed'::public.table_booking_status;
    v_target_hold_expires_at := NULL;
  END IF;

  SELECT tb.id
  INTO v_table_booking_id
  FROM public.table_bookings tb
  WHERE tb.event_booking_id = p_event_booking_id
    AND tb.status <> 'cancelled'::public.table_booking_status
  ORDER BY tb.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_table_booking_id IS NOT NULL THEN
    UPDATE public.table_bookings
    SET
      party_size = p_party_size,
      committed_party_size = p_party_size,
      status = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.status
        ELSE v_target_status
      END,
      confirmed_at = CASE
        WHEN v_target_status = 'confirmed'::public.table_booking_status
          THEN COALESCE(tb.confirmed_at, NOW())
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.confirmed_at
        ELSE NULL
      END,
      hold_expires_at = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.hold_expires_at
        ELSE v_target_hold_expires_at
      END,
      source = v_source,
      booking_type = 'regular'::public.table_booking_type,
      booking_purpose = 'drinks',
      special_requirements = COALESCE(v_note_text, tb.special_requirements),
      event_id = p_event_id,
      event_booking_id = p_event_booking_id,
      updated_at = NOW()
    FROM public.table_bookings tb
    WHERE public.table_bookings.id = v_table_booking_id
      AND tb.id = v_table_booking_id;

    IF v_target_status = 'confirmed'::public.table_booking_status AND p_party_size < 15 THEN
      PERFORM public.neutralise_under10_table_deposit_state_v01(
        v_table_booking_id,
        'event_table_reservation_confirmed_under10_existing'
      );
    END IF;

    SELECT tb.booking_reference, tb.start_datetime, tb.end_datetime
    INTO v_booking_reference, v_reservation_start, v_event_end
    FROM public.table_bookings tb
    WHERE tb.id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
    FROM public.booking_table_assignments bta
    JOIN public.tables t ON t.id = bta.table_id
    WHERE bta.table_booking_id = v_table_booking_id;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', v_table_booking_id,
      'booking_reference', v_booking_reference,
      'table_name', CASE
        WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
        ELSE array_to_string(v_table_names, ' + ')
      END,
      'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  END IF;

  BEGIN
    IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL THEN
      v_table_result := public.create_table_booking_v05_core(
        p_customer_id, v_reservation_date, v_reservation_time,
        p_party_size, 'drinks', v_note_text, false, v_source
      );
    ELSE
      v_table_result := public.create_table_booking_v05(
        p_customer_id, v_reservation_date, v_reservation_time,
        p_party_size, 'drinks', v_note_text, false, v_source
      );
    END IF;

    v_table_state := COALESCE(v_table_result->>'state', 'blocked');
    IF v_table_state NOT IN ('confirmed', 'pending_payment') THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', COALESCE(v_table_result->>'reason', 'no_table')
      );
    END IF;

    v_table_booking_id := NULLIF(v_table_result->>'table_booking_id', '')::uuid;
    IF v_table_booking_id IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END IF;

    -- The ordinary core reserves its standard duration. Re-select against the full
    -- event window before committing, excluding only this newly-created booking.
    SELECT c.* INTO v_full_candidate
    FROM public.find_table_allocation_candidates(
      v_reservation_start, v_event_end, p_party_size, 'drinks', 0, false,
      NULL, 'event', v_table_booking_id
    ) c WHERE c.reason_code IS NULL ORDER BY c.rank LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_table' USING ERRCODE = 'P2004';
    END IF;
    DELETE FROM public.booking_table_assignments WHERE table_booking_id = v_table_booking_id;
    INSERT INTO public.booking_table_assignments(table_booking_id, table_id, start_datetime, end_datetime)
    SELECT v_table_booking_id, chosen.id, v_reservation_start, v_event_end
      FROM unnest(v_full_candidate.table_ids) AS chosen(id) ORDER BY chosen.id;

    UPDATE public.booking_holds
    SET status = 'released',
        released_at = NOW(),
        updated_at = NOW()
    WHERE table_booking_id = v_table_booking_id
      AND hold_type = 'payment_hold'
      AND status = 'active';

    UPDATE public.table_bookings
    SET status = v_target_status,
        confirmed_at = CASE
          WHEN v_target_status = 'confirmed'::public.table_booking_status THEN COALESCE(confirmed_at, NOW())
          ELSE NULL
        END,
        hold_expires_at = v_target_hold_expires_at,
        source = v_source,
        booking_type = 'regular'::public.table_booking_type,
        booking_purpose = 'drinks',
        special_requirements = COALESCE(v_note_text, special_requirements),
        event_id = p_event_id,
        event_booking_id = p_event_booking_id,
        party_size = p_party_size,
        committed_party_size = p_party_size,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    SELECT MAX(end_datetime)
    INTO v_current_assignment_end
    FROM public.booking_table_assignments
    WHERE table_booking_id = v_table_booking_id;

    IF v_current_assignment_end IS NULL THEN
      v_current_assignment_end := v_reservation_start;
    END IF;

    IF v_event_end > v_current_assignment_end THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.booking_table_assignments current_bta
        JOIN public.booking_table_assignments other_bta
          ON other_bta.table_id = current_bta.table_id
        JOIN public.table_bookings other_tb
          ON other_tb.id = other_bta.table_booking_id
        WHERE current_bta.table_booking_id = v_table_booking_id
          AND other_bta.table_booking_id <> v_table_booking_id
          AND other_tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
          AND other_tb.left_at IS NULL
          AND other_bta.start_datetime < v_event_end
          AND other_bta.end_datetime > v_current_assignment_end
      ) INTO v_conflict_exists;

      IF v_conflict_exists THEN
        DELETE FROM public.table_bookings WHERE id = v_table_booking_id;
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
      END IF;
    END IF;

    v_duration_minutes := GREATEST(
      30,
      CEIL(EXTRACT(EPOCH FROM (v_event_end - v_reservation_start)) / 60.0)::integer
    );

    UPDATE public.booking_table_assignments
    SET start_datetime = v_reservation_start,
        end_datetime = v_event_end
    WHERE table_booking_id = v_table_booking_id;

    UPDATE public.table_bookings
    SET booking_date = v_reservation_date,
        booking_time = v_reservation_time,
        start_datetime = v_reservation_start,
        end_datetime = v_event_end,
        duration_minutes = v_duration_minutes,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    IF v_target_status = 'confirmed'::public.table_booking_status AND p_party_size < 15 THEN
      PERFORM public.neutralise_under10_table_deposit_state_v01(
        v_table_booking_id,
        'event_table_reservation_confirmed_under10_new'
      );
    END IF;

    SELECT booking_reference INTO v_booking_reference
    FROM public.table_bookings WHERE id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
    FROM public.booking_table_assignments bta
    JOIN public.tables t ON t.id = bta.table_id
    WHERE bta.table_booking_id = v_table_booking_id;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', v_table_booking_id,
      'booking_reference', v_booking_reference,
      'table_name', CASE
        WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
        ELSE array_to_string(v_table_names, ' + ')
      END,
      'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_table_reservation_v05(uuid,uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid,uuid,uuid,integer,text,text) TO service_role;
