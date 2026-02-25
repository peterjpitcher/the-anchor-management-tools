-- Generalise the £10 per person table deposit to all bookings of 7+ people,
-- not just Sunday lunch. Event bookings are structurally excluded because they
-- use create_event_table_reservation_v05, never create_table_booking_v05.

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

  -- Require deposit for Sunday lunch OR any booking of 7+ people
  IF COALESCE(p_sunday_lunch, false) = false AND COALESCE(p_party_size, 0) < 7 THEN
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
