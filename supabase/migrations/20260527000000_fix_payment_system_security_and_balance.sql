-- Fix payment system: security, discount-aware balance, overpayment cap, status guard
--
-- SEC-001: record_balance_payment RPC has no internal permission check
-- CR-2:    All DB balance functions ignore booking-level discounts
-- ID-2:    Overpayments accepted without cap
-- ID-6:    Cancelled/completed bookings can accept balance payments

-- ============================================================================
-- 1. Helper: compute discount-aware total for a booking
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_booking_discounted_total(p_booking_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_items_total NUMERIC;
  v_discount_type TEXT;
  v_discount_amount NUMERIC;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
  FROM public.private_booking_items
  WHERE booking_id = p_booking_id;

  SELECT discount_type, COALESCE(discount_amount, 0)
  INTO v_discount_type, v_discount_amount
  FROM public.private_bookings
  WHERE id = p_booking_id;

  IF v_discount_type = 'percent' AND v_discount_amount > 0 THEN
    RETURN GREATEST(0, v_items_total * (1 - v_discount_amount / 100));
  ELSIF v_discount_type = 'fixed' AND v_discount_amount > 0 THEN
    RETURN GREATEST(0, v_items_total - v_discount_amount);
  END IF;

  RETURN v_items_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_discounted_total(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_booking_discounted_total(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_discounted_total(uuid) TO service_role;

-- ============================================================================
-- 2. CR-2: Update calculate_private_booking_balance to use discounted total
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_total NUMERIC;
  v_payments_sum NUMERIC;
BEGIN
  -- Get discount-aware total
  v_total := public.get_booking_discounted_total(p_booking_id);

  -- Sum of balance payments recorded
  SELECT COALESCE(SUM(amount), 0) INTO v_payments_sum
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  -- Security deposit is a returnable bond — it does NOT reduce the event cost.
  RETURN GREATEST(0, v_total - v_payments_sum);
END;
$$;

-- ============================================================================
-- 3. CR-2: Update apply_balance_payment_status to use discounted total
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_balance_payment_status(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total        numeric;
  v_paid         numeric;
  v_remaining    numeric;
  v_last_method  text;
BEGIN
  -- Use discount-aware total
  v_total := public.get_booking_discounted_total(p_booking_id);

  -- Sum balance payments
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.private_booking_payments WHERE booking_id = p_booking_id;

  v_remaining := GREATEST(0, v_total - v_paid);

  -- Only stamp final payment if booking actually has items (total > 0)
  IF v_remaining = 0 AND v_total > 0 THEN
    SELECT method INTO v_last_method
    FROM public.private_booking_payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE public.private_bookings
    SET final_payment_date   = now(),
        final_payment_method = v_last_method
    WHERE id = p_booking_id
      AND final_payment_date IS NULL;

  ELSIF v_remaining > 0 THEN
    UPDATE public.private_bookings
    SET final_payment_date   = NULL,
        final_payment_method = NULL
    WHERE id = p_booking_id
      AND final_payment_date IS NOT NULL;
  END IF;
END;
$$;

-- ============================================================================
-- 4. SEC-001 + CR-2 + ID-2 + ID-6: Rebuild record_balance_payment RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_balance_payment(
  p_booking_id UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_recorded_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking RECORD;
  v_discounted_total NUMERIC;
  v_payments_total NUMERIC;
  v_remaining NUMERIC;
BEGIN
  -- SEC-001: Permission check — prevent direct RPC calls by unprivileged users
  IF NOT public.user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits') THEN
    RAISE EXCEPTION 'Permission denied: manage_deposits required';
  END IF;

  -- Fetch booking with a row-level lock to prevent concurrent payment races
  SELECT id, status, event_date, start_time, end_time, customer_first_name, customer_last_name,
         customer_name, contact_phone, customer_id, calendar_event_id, guest_count, event_type,
         deposit_paid_date, deposit_amount, total_amount
  INTO v_booking
  FROM public.private_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

  -- ID-6: Block payments on cancelled or completed bookings
  IF v_booking.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot record payment on a % booking', v_booking.status;
  END IF;

  -- CR-2: Use discount-aware total
  v_discounted_total := public.get_booking_discounted_total(p_booking_id);

  -- Calculate total already paid (before this new payment)
  SELECT COALESCE(SUM(amount), 0) INTO v_payments_total
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  -- ID-2: Reject overpayment
  v_remaining := GREATEST(0, v_discounted_total - v_payments_total);
  IF p_amount > v_remaining + 0.005 THEN
    RAISE EXCEPTION 'Amount (%) exceeds remaining balance (%)', p_amount, v_remaining;
  END IF;

  -- Insert the payment record
  INSERT INTO public.private_booking_payments (booking_id, amount, method, recorded_by)
  VALUES (p_booking_id, p_amount, p_method, p_recorded_by);

  -- Recalculate after insertion
  v_payments_total := v_payments_total + p_amount;
  v_remaining := GREATEST(0, v_discounted_total - v_payments_total);

  -- If fully paid, stamp the booking with the final payment details
  IF v_remaining <= 0 THEN
    UPDATE public.private_bookings
    SET final_payment_date = NOW(),
        final_payment_method = p_method,
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'total_paid', v_payments_total,
    'remaining_balance', v_remaining,
    'is_fully_paid', v_remaining <= 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_balance_payment(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_balance_payment(UUID, NUMERIC, TEXT, UUID) TO service_role;

-- ============================================================================
-- 5. CR-2: Update the view to use discount-aware calculated_total
-- ============================================================================

CREATE OR REPLACE VIEW public.private_bookings_with_details AS
 SELECT
  pb.id,
  pb.customer_id,
  pb.customer_name,
  pb.contact_phone,
  pb.contact_email,
  pb.event_date,
  pb.start_time,
  pb.setup_time,
  pb.end_time,
  pb.end_time_next_day,
  pb.guest_count,
  pb.event_type,
  pb.status,
  pb.deposit_amount,
  pb.deposit_paid_date,
  pb.deposit_payment_method,
  pb.total_amount,
  pb.balance_due_date,
  pb.final_payment_date,
  pb.final_payment_method,
  pb.calendar_event_id,
  pb.contract_version,
  pb.internal_notes,
  pb.customer_requests,
  pb.created_by,
  pb.created_at,
  pb.updated_at,
  pb.setup_date,
  pb.discount_type,
  pb.discount_amount,
  pb.discount_reason,
  pb.customer_first_name,
  pb.customer_last_name,
  pb.customer_full_name,
  c.mobile_number AS customer_mobile,
  public.get_booking_discounted_total(pb.id) AS calculated_total,
  CASE
    WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
    WHEN pb.status = 'confirmed'::text THEN 'Required'::text
    ELSE 'Not Required'::text
  END AS deposit_status,
  (pb.event_date - CURRENT_DATE) AS days_until_event,
  pb.contract_note,
  pb.hold_expiry,
  (
    SELECT COALESCE(SUM(pbp.amount), 0)
    FROM public.private_booking_payments pbp
    WHERE pbp.booking_id = pb.id
  ) AS total_balance_paid,
  public.calculate_private_booking_balance(pb.id) AS balance_remaining,
  CASE
    WHEN public.calculate_private_booking_balance(pb.id) <= 0 THEN 'Fully Paid'::text
    WHEN (
      SELECT COALESCE(SUM(pbp.amount), 0)
      FROM public.private_booking_payments pbp
      WHERE pbp.booking_id = pb.id
    ) > 0 THEN 'Partially Paid'::text
    ELSE 'Unpaid'::text
  END AS payment_status
 FROM public.private_bookings pb
 LEFT JOIN public.customers c ON pb.customer_id = c.id;

ALTER VIEW public.private_bookings_with_details SET (security_invoker = true);
REVOKE ALL ON public.private_bookings_with_details FROM anon;
GRANT SELECT ON public.private_bookings_with_details TO authenticated;
GRANT SELECT ON public.private_bookings_with_details TO service_role;
