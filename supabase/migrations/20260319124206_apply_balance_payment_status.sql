CREATE OR REPLACE FUNCTION apply_balance_payment_status(p_booking_id uuid)
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
  -- Sum line items
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM private_booking_items WHERE booking_id = p_booking_id;

  -- Sum balance payments
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM private_booking_payments WHERE booking_id = p_booking_id;

  v_remaining := GREATEST(0, v_total - v_paid);

  -- Only stamp final payment if booking actually has items (total > 0)
  IF v_remaining = 0 AND v_total > 0 THEN
    -- Get method of last remaining payment for final_payment_method
    SELECT method INTO v_last_method
    FROM private_booking_payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE private_bookings
    SET final_payment_date   = now(),
        final_payment_method = v_last_method
    WHERE id = p_booking_id
      AND final_payment_date IS NULL;

  ELSIF v_remaining > 0 THEN
    UPDATE private_bookings
    SET final_payment_date   = NULL,
        final_payment_method = NULL
    WHERE id = p_booking_id
      AND final_payment_date IS NOT NULL;
  END IF;
END;
$$;