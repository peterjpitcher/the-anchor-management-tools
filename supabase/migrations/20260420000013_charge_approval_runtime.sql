-- v0.5 manager charge-approval runtime helpers

CREATE OR REPLACE FUNCTION public.get_charge_request_approval_preview_v05(
  p_hashed_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_charge RECORD;
  v_customer RECORD;
  v_table_name text;
  v_payment_method_id text;
  v_party_size integer := 1;
BEGIN
  SELECT
    gt.id,
    gt.customer_id,
    gt.charge_request_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'charge_approval'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_used');
  END IF;

  IF v_token.expires_at <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.charge_request_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'charge_request_missing');
  END IF;

  SELECT
    cr.id,
    cr.table_booking_id,
    cr.type,
    cr.amount,
    cr.currency,
    cr.metadata,
    cr.manager_decision,
    cr.charge_status,
    cr.created_at,
    cr.decided_at,
    cr.stripe_payment_intent_id,
    tb.customer_id,
    tb.booking_reference,
    tb.booking_date,
    tb.booking_time,
    tb.party_size,
    tb.committed_party_size,
    tb.status AS booking_status,
    tb.start_datetime,
    tb.end_datetime
  INTO v_charge
  FROM public.charge_requests cr
  JOIN public.table_bookings tb ON tb.id = cr.table_booking_id
  WHERE cr.id = v_token.charge_request_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'charge_request_not_found');
  END IF;

  IF v_charge.customer_id IS NULL OR v_charge.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.mobile_number,
    c.mobile_e164,
    c.stripe_customer_id
  INTO v_customer
  FROM public.customers c
  WHERE c.id = v_charge.customer_id
  LIMIT 1;

  SELECT
    COALESCE(t.name, t.table_number)
  INTO v_table_name
  FROM public.booking_table_assignments bta
  JOIN public.tables t ON t.id = bta.table_id
  WHERE bta.table_booking_id = v_charge.table_booking_id
  ORDER BY bta.created_at DESC
  LIMIT 1;

  SELECT
    cc.stripe_payment_method_id
  INTO v_payment_method_id
  FROM public.card_captures cc
  WHERE cc.table_booking_id = v_charge.table_booking_id
    AND cc.status = 'completed'
    AND cc.stripe_payment_method_id IS NOT NULL
  ORDER BY cc.captured_at DESC NULLS LAST, cc.created_at DESC
  LIMIT 1;

  v_party_size := GREATEST(COALESCE(v_charge.committed_party_size, v_charge.party_size, 1), 1);

  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_charge.manager_decision IS NULL AND v_charge.charge_status = 'pending' THEN 'ready'
      ELSE 'already_decided'
    END,
    'charge_request_id', v_charge.id,
    'table_booking_id', v_charge.table_booking_id,
    'customer_id', v_charge.customer_id,
    'type', v_charge.type,
    'amount', v_charge.amount,
    'currency', v_charge.currency,
    'metadata', COALESCE(v_charge.metadata, '{}'::jsonb),
    'manager_decision', v_charge.manager_decision,
    'charge_status', v_charge.charge_status,
    'created_at', v_charge.created_at,
    'decided_at', v_charge.decided_at,
    'stripe_payment_intent_id', v_charge.stripe_payment_intent_id,
    'booking_reference', v_charge.booking_reference,
    'booking_date', v_charge.booking_date,
    'booking_time', v_charge.booking_time,
    'booking_status', v_charge.booking_status,
    'start_datetime', v_charge.start_datetime,
    'end_datetime', v_charge.end_datetime,
    'party_size', v_charge.party_size,
    'committed_party_size', v_charge.committed_party_size,
    'table_name', v_table_name,
    'customer_first_name', COALESCE(v_customer.first_name, ''),
    'customer_last_name', COALESCE(v_customer.last_name, ''),
    'customer_mobile', COALESCE(v_customer.mobile_e164, v_customer.mobile_number),
    'stripe_customer_id', v_customer.stripe_customer_id,
    'stripe_payment_method_id', v_payment_method_id,
    'payment_method_available', v_payment_method_id IS NOT NULL,
    'requires_amount_reentry', v_charge.type = 'walkout',
    'warning_over_200', v_charge.amount > 200,
    'warning_over_50_per_head', v_charge.amount > (v_party_size * 50),
    'warning_needs_extra_confirmation', v_charge.amount > 200 OR v_charge.amount > (v_party_size * 50)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_charge_request_approval_preview_v05(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_charge_request_approval_preview_v05(text) TO service_role;

CREATE OR REPLACE FUNCTION public.decide_charge_request_v05(
  p_hashed_token text,
  p_decision text,
  p_approved_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_charge RECORD;
  v_customer RECORD;
  v_decision text;
  v_now timestamptz := NOW();
  v_effective_amount numeric(10, 2);
  v_payment_method_id text;
BEGIN
  v_decision := LOWER(TRIM(COALESCE(p_decision, '')));
  IF v_decision NOT IN ('approved', 'waived') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_decision');
  END IF;

  SELECT
    gt.id,
    gt.customer_id,
    gt.charge_request_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'charge_approval'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_used');
  END IF;

  IF v_token.expires_at <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.charge_request_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'charge_request_missing');
  END IF;

  SELECT
    cr.id,
    cr.table_booking_id,
    cr.type,
    cr.amount,
    cr.currency,
    cr.metadata,
    cr.manager_decision,
    cr.charge_status,
    tb.customer_id,
    tb.booking_reference,
    tb.booking_date,
    tb.booking_time,
    tb.party_size,
    tb.committed_party_size,
    tb.status AS booking_status,
    tb.start_datetime,
    tb.end_datetime
  INTO v_charge
  FROM public.charge_requests cr
  JOIN public.table_bookings tb ON tb.id = cr.table_booking_id
  WHERE cr.id = v_token.charge_request_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'charge_request_not_found');
  END IF;

  IF v_charge.customer_id IS NULL OR v_charge.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_charge.manager_decision IS NOT NULL OR v_charge.charge_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'state', 'already_decided',
      'charge_request_id', v_charge.id,
      'manager_decision', v_charge.manager_decision,
      'charge_status', v_charge.charge_status,
      'amount', v_charge.amount,
      'currency', v_charge.currency
    );
  END IF;

  IF v_decision = 'approved' THEN
    v_effective_amount := COALESCE(p_approved_amount, v_charge.amount)::numeric(10, 2);

    IF v_effective_amount IS NULL OR v_effective_amount <= 0 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_amount');
    END IF;

    UPDATE public.charge_requests cr
    SET
      amount = v_effective_amount,
      manager_decision = 'approved',
      decided_at = v_now,
      updated_at = v_now
    WHERE cr.id = v_charge.id
      AND cr.manager_decision IS NULL
      AND cr.charge_status = 'pending'
    RETURNING
      cr.id,
      cr.table_booking_id,
      cr.type,
      cr.amount,
      cr.currency,
      cr.metadata,
      cr.manager_decision,
      cr.charge_status,
      cr.stripe_payment_intent_id
    INTO v_charge;
  ELSE
    UPDATE public.charge_requests cr
    SET
      manager_decision = 'waived',
      charge_status = 'waived',
      decided_at = v_now,
      updated_at = v_now
    WHERE cr.id = v_charge.id
      AND cr.manager_decision IS NULL
      AND cr.charge_status = 'pending'
    RETURNING
      cr.id,
      cr.table_booking_id,
      cr.type,
      cr.amount,
      cr.currency,
      cr.metadata,
      cr.manager_decision,
      cr.charge_status,
      cr.stripe_payment_intent_id
    INTO v_charge;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'already_decided', 'charge_request_id', v_token.charge_request_id);
  END IF;

  UPDATE public.guest_tokens
  SET consumed_at = v_now
  WHERE id = v_token.id
    AND consumed_at IS NULL;

  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.mobile_number,
    c.mobile_e164,
    c.stripe_customer_id
  INTO v_customer
  FROM public.customers c
  WHERE c.id = v_token.customer_id
  LIMIT 1;

  SELECT
    cc.stripe_payment_method_id
  INTO v_payment_method_id
  FROM public.card_captures cc
  WHERE cc.table_booking_id = v_charge.table_booking_id
    AND cc.status = 'completed'
    AND cc.stripe_payment_method_id IS NOT NULL
  ORDER BY cc.captured_at DESC NULLS LAST, cc.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'state', 'decision_applied',
    'decision', v_decision,
    'charge_request_id', v_charge.id,
    'table_booking_id', v_charge.table_booking_id,
    'customer_id', v_token.customer_id,
    'type', v_charge.type,
    'amount', v_charge.amount,
    'currency', v_charge.currency,
    'metadata', COALESCE(v_charge.metadata, '{}'::jsonb),
    'manager_decision', v_charge.manager_decision,
    'charge_status', v_charge.charge_status,
    'stripe_payment_intent_id', v_charge.stripe_payment_intent_id,
    'stripe_customer_id', v_customer.stripe_customer_id,
    'stripe_payment_method_id', v_payment_method_id,
    'customer_mobile', COALESCE(v_customer.mobile_e164, v_customer.mobile_number)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_charge_request_v05(text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_charge_request_v05(text, text, numeric) TO service_role;
