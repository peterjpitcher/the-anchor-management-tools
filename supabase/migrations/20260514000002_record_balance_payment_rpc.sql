-- Atomic RPC for recording a private booking balance payment.
-- Wraps the 4 sequential queries previously in recordBalancePayment() into a
-- single transaction with a FOR UPDATE lock, preventing inconsistent state if
-- the application server dies between steps.

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
  v_items_total NUMERIC;
  v_payments_total NUMERIC;
  v_remaining NUMERIC;
BEGIN
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

  -- Insert the payment record
  INSERT INTO public.private_booking_payments (booking_id, amount, method, recorded_by)
  VALUES (p_booking_id, p_amount, p_method, p_recorded_by);

  -- Calculate items total
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
  FROM public.private_booking_items
  WHERE booking_id = p_booking_id;

  -- Calculate total paid (including the payment just inserted)
  SELECT COALESCE(SUM(amount), 0) INTO v_payments_total
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  -- Security deposit is a returnable bond — it does NOT reduce the event cost.
  -- Remaining balance cannot go below zero.
  v_remaining := GREATEST(0, v_items_total - v_payments_total);

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
