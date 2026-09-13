-- Separately approved data repair. Provider evidence checked read-only on 2026-09-05.
-- PayPal order 1NX08920NB808283W, completed GBP capture 62921439S0526370F.
SET lock_timeout = '5s';
DO $$
DECLARE v_booking public.private_bookings%ROWTYPE; v_invoice public.invoices%ROWTYPE;
  v_deposit numeric; v_existing public.invoice_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.private_bookings
  WHERE id = 'c28527fe-a373-460d-85a8-e509b78d6eba' FOR UPDATE;
  IF NOT FOUND OR v_booking.invoice_id IS DISTINCT FROM '8a590bb4-487b-4522-929b-b5c6c3f81071'::uuid
     OR v_booking.invoice_deposit_treatment IS DISTINCT FROM 'deducted' THEN
    RAISE EXCEPTION 'verified_capture_booking_link_changed';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_booking.invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.total_amount IS DISTINCT FROM 994.80::numeric
     OR v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'verified_capture_invoice_changed';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_deposit FROM public.invoice_payments
  WHERE invoice_id = v_invoice.id AND source_kind = 'booking_deposit';
  IF v_deposit <> 250 THEN RAISE EXCEPTION 'verified_capture_deposit_changed'; END IF;
  SELECT * INTO v_existing FROM public.invoice_payments
  WHERE source_kind = 'paypal' AND reference = '62921439S0526370F';
  IF FOUND AND (v_existing.invoice_id IS DISTINCT FROM v_invoice.id OR v_existing.amount IS DISTINCT FROM 744.80::numeric) THEN
    RAISE EXCEPTION 'verified_capture_conflict';
  END IF;
  PERFORM public.record_invoice_paypal_payment_atomic(v_invoice.id, 744.80, '62921439S0526370F',
    '1NX08920NB808283W', '2026-09-04T13:38:30Z'::timestamptz);
  -- An old application instance may have raced this repair using its capture-day
  -- default. Only this provider-verified row is corrected; the amount is untouched.
  UPDATE public.invoice_payments SET payment_date = '2026-09-04'::date
  WHERE invoice_id = v_invoice.id AND source_kind = 'paypal' AND reference = '62921439S0526370F'
    AND amount = 744.80 AND payment_date IS DISTINCT FROM '2026-09-04'::date;
  PERFORM public.apply_balance_payment_status(v_booking.id);
END;
$$;
RESET lock_timeout;
