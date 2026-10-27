-- Close out a private hire in one transaction (review of release 13, BK-062 and BK-131).
--
-- The close-out used to run as separate writes from the app: put the deposit against the bill
-- (a balance payment), return the deposit (a refund row), record the balance, then close the
-- booking. If a later step failed, the earlier ones stayed: a deposit applied to the bill with
-- the booking still showing it open, so a retry applied it twice; or a refund committed and the
-- balance then refused. record_balance_payment also refuses a completed booking, which the
-- close-out allows.
--
-- close_out_private_booking does it all under the booking's row lock, inside one transaction:
-- either every part is recorded and the booking is closed, or nothing is. Once a deposit's
-- outcome is recorded it is no longer open, so a repeated call is refused instead of applying it
-- again. It sends nothing and is callable by the service role only (the app's server action
-- checks the staff member's permissions first).
--
-- An invoiced hire is refused for the two parts that would write a booking payment (the deposit
-- put against the bill, and the balance settled at the till): its payments belong on the
-- invoice, and the payment trigger refuses them on the booking anyway. Returning or keeping the
-- deposit, and closing the booking, still work for an invoiced hire.
--
-- New function only. No table, view or existing function changes.

CREATE FUNCTION public.close_out_private_booking(
  p_booking_id uuid,
  p_balance_method text,
  p_deposit_outcome text,
  p_deposit_method text,
  p_kept_amount numeric,
  p_kept_reason text,
  p_performed_by uuid
)
RETURNS TABLE(balance_recorded numeric, deposit_status text, deposit_handled numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_booking public.private_bookings%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/London')::date;
  v_deposit numeric(10,2);
  v_refunded numeric(10,2);
  v_left numeric(10,2) := 0;
  v_open boolean;
  v_status text;
  v_rest numeric(10,2) := 0;
  v_kept numeric(10,2);
  v_remaining numeric(10,2);
  v_balance numeric(10,2) := 0;
  v_audit jsonb := '{}'::jsonb;
BEGIN
  IF p_balance_method IS NOT NULL AND p_balance_method NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'close_out: The balance must be settled by card or cash';
  END IF;
  IF p_deposit_outcome IS NOT NULL AND p_deposit_outcome NOT IN ('returned', 'kept', 'applied') THEN
    RAISE EXCEPTION 'close_out: Unknown deposit outcome';
  END IF;
  IF p_deposit_method IS NOT NULL AND p_deposit_method NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'close_out: The deposit must be returned by card or cash';
  END IF;

  SELECT * INTO v_booking FROM public.private_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'close_out: Booking not found'; END IF;
  -- The same lock reserve_refund_balance takes, so a refund cannot be reserved alongside.
  PERFORM pg_advisory_xact_lock(hashtext('private_booking:' || p_booking_id::text));

  IF v_booking.status IS DISTINCT FROM 'confirmed' AND v_booking.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'close_out: Only a confirmed or completed hire can be closed out';
  END IF;
  IF v_booking.event_date IS NULL OR v_booking.event_date > v_today THEN
    RAISE EXCEPTION 'close_out: A hire can only be closed out on or after the day of the event';
  END IF;

  v_deposit := round(COALESCE(v_booking.deposit_amount, 0), 2);
  v_open := v_booking.deposit_paid_date IS NOT NULL AND v_deposit > 0
    AND v_booking.invoice_deposit_treatment IS DISTINCT FROM 'deducted'
    AND (v_booking.deposit_refund_status IS NULL OR v_booking.deposit_refund_status = 'partially_refunded');
  SELECT round(COALESCE(SUM(amount), 0), 2) INTO v_refunded
  FROM public.payment_refunds
  WHERE source_type = 'private_booking' AND source_id = p_booking_id AND status IN ('completed', 'pending');
  IF v_open THEN v_left := GREATEST(0, v_deposit - v_refunded); END IF;

  IF p_deposit_outcome IS NOT NULL AND (NOT v_open OR v_left <= 0) THEN
    RAISE EXCEPTION 'close_out: This booking has no deposit left to close';
  END IF;
  IF v_open AND v_left > 0 AND p_deposit_outcome IS NULL THEN
    RAISE EXCEPTION 'close_out: Say what happened to the deposit before closing the hire';
  END IF;

  v_status := v_booking.deposit_refund_status;

  IF p_deposit_outcome = 'applied' THEN
    IF v_booking.invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'close_out: This hire is invoiced: put the deposit against the invoice instead';
    END IF;
    v_remaining := public.calculate_private_booking_balance(p_booking_id);
    IF v_left > v_remaining THEN
      RAISE EXCEPTION 'close_out: The deposit (£%) is more than the balance left to pay (£%): return or keep it instead', v_left, v_remaining;
    END IF;
    INSERT INTO public.private_booking_payments(booking_id, amount, method, notes, recorded_by)
    VALUES (p_booking_id, v_left,
      CASE WHEN v_booking.deposit_payment_method = 'cash' THEN 'cash' ELSE 'card' END,
      'Deposit put against the final bill at close-out', p_performed_by);
    v_status := 'applied';
    v_audit := v_audit || jsonb_build_object('deposit', jsonb_build_object('outcome', 'applied', 'amount', v_left));
  ELSIF p_deposit_outcome = 'returned' THEN
    IF p_deposit_method IS NULL THEN
      RAISE EXCEPTION 'close_out: Say how the deposit was returned';
    END IF;
    v_rest := v_left;
    v_status := 'refunded';
    v_audit := v_audit || jsonb_build_object('deposit', jsonb_build_object('outcome', 'returned', 'amount', v_left, 'method', p_deposit_method));
  ELSIF p_deposit_outcome = 'kept' THEN
    IF p_kept_amount IS NULL OR p_kept_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_kept_amount <= 0 OR p_kept_amount <> round(p_kept_amount, 2) OR p_kept_amount > v_left THEN
      RAISE EXCEPTION 'close_out: The amount kept must be between £0.01 and £%', v_left;
    END IF;
    IF btrim(COALESCE(p_kept_reason, '')) = '' THEN
      RAISE EXCEPTION 'close_out: Please record why the deposit was kept';
    END IF;
    v_kept := p_kept_amount;
    v_rest := v_left - v_kept;
    IF v_rest > 0 AND p_deposit_method IS NULL THEN
      RAISE EXCEPTION 'close_out: Say how the rest of the deposit was returned';
    END IF;
    v_status := CASE WHEN v_rest > 0 THEN 'partially_retained' ELSE 'retained' END;
    v_audit := v_audit || jsonb_build_object('deposit', jsonb_build_object('outcome', v_status, 'kept', v_kept,
      'reason', btrim(p_kept_reason), 'returned', v_rest));
  END IF;

  IF v_rest > 0 THEN
    INSERT INTO public.payment_refunds(source_type, source_id, refund_method, amount, original_amount, reason,
      status, initiated_by, initiated_by_type, notification_status, completed_at)
    VALUES ('private_booking', p_booking_id, CASE WHEN p_deposit_method = 'cash' THEN 'cash' ELSE 'other' END,
      v_rest, v_deposit,
      CASE WHEN p_deposit_outcome = 'kept' THEN 'The rest of the deposit, returned at the till after the event'
           ELSE 'Returned at the till after the event' END,
      'completed', p_performed_by, 'staff', 'skipped', now());
  END IF;

  IF p_balance_method IS NOT NULL THEN
    v_remaining := public.calculate_private_booking_balance(p_booking_id);
    IF v_remaining > 0 THEN
      IF v_booking.invoice_id IS NOT NULL THEN
        RAISE EXCEPTION 'close_out: This hire is invoiced: record the balance as a payment on its invoice';
      END IF;
      INSERT INTO public.private_booking_payments(booking_id, amount, method, notes, recorded_by)
      VALUES (p_booking_id, v_remaining, p_balance_method, 'Settled at the till, recorded at close-out', p_performed_by);
      v_balance := v_remaining;
    END IF;
    v_audit := v_audit || jsonb_build_object('balance', jsonb_build_object('settled_at_till', true,
      'method', p_balance_method, 'amount', v_balance));
  END IF;

  UPDATE public.private_bookings
  SET status = 'completed',
      post_event_status = 'complete',
      deposit_refund_status = v_status,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.private_booking_audit(booking_id, action, old_value, new_value, performed_by, metadata)
  VALUES (p_booking_id, 'closed_out', v_booking.status, 'completed', p_performed_by, v_audit);

  RETURN QUERY SELECT v_balance::numeric, v_status::text,
    (CASE WHEN p_deposit_outcome IS NULL THEN 0 ELSE v_left END)::numeric;
END;
$$;

REVOKE ALL ON FUNCTION public.close_out_private_booking(uuid, text, text, text, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_out_private_booking(uuid, text, text, text, numeric, text, uuid) TO service_role;
