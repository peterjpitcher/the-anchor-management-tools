-- Non-PII function definitions read from tfcasgxopxegwrabvwat on 2026-09-05.
CREATE OR REPLACE FUNCTION public.assert_rpc_permission(p_module text, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_role text;
  v_uid  uuid;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  -- Trusted server-side path: service_role key (cron, admin client).
  if v_role = 'service_role' then
    return;
  end if;

  v_uid := auth.uid();

  if v_uid is null or not public.user_has_permission(v_uid, p_module, p_action) then
    raise exception 'permission_denied: %.%', p_module, p_action
      using errcode = '42501';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_booking_discounted_total(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_booking_gross_total(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN ROUND(public.get_booking_discounted_total(p_booking_id), 2)
       + public.get_booking_vat_amount(p_booking_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_booking_vat_amount(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_items_total NUMERIC;
  v_vat_raw NUMERIC;
  v_discount_type TEXT;
  v_discount_amount NUMERIC;
  v_factor NUMERIC := 1;
BEGIN
  SELECT COALESCE(SUM(line_total), 0), COALESCE(SUM(line_total * COALESCE(vat_rate, 20) / 100), 0)
  INTO v_items_total, v_vat_raw
  FROM public.private_booking_items
  WHERE booking_id = p_booking_id;

  IF v_items_total <= 0 THEN
    RETURN 0;
  END IF;

  SELECT discount_type, COALESCE(discount_amount, 0)
  INTO v_discount_type, v_discount_amount
  FROM public.private_bookings
  WHERE id = p_booking_id;

  IF v_discount_type = 'percent' AND v_discount_amount > 0 THEN
    v_factor := GREATEST(0, 1 - v_discount_amount / 100);
  ELSIF v_discount_type = 'fixed' AND v_discount_amount > 0 THEN
    v_factor := GREATEST(0, v_items_total - v_discount_amount) / v_items_total;
  END IF;

  RETURN ROUND(v_vat_raw * v_factor, 2);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_refund_balance(p_source_type text, p_source_id uuid, p_original_amount numeric, p_amount numeric, p_refund_method text, p_reason text, p_initiated_by uuid, p_paypal_capture_id text DEFAULT NULL::text, p_paypal_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(refund_id uuid, remaining numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total_reserved NUMERIC(10,2);
  v_remaining NUMERIC(10,2);
  v_new_id UUID;
BEGIN
  -- 1. Acquire advisory lock scoped to (source_type, source_id)
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_type || ':' || p_source_id::text)
  );

  -- 2. Calculate total already reserved (completed + pending)
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_reserved
  FROM public.payment_refunds
  WHERE source_type = p_source_type
    AND source_id = p_source_id
    AND status IN ('completed', 'pending');

  v_remaining := p_original_amount - v_total_reserved;

  -- 3. Validate the requested amount fits within the remaining balance
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'Amount %.2f exceeds refundable balance %.2f', p_amount, v_remaining;
  END IF;

  -- 4. Insert the pending refund row
  INSERT INTO public.payment_refunds (
    source_type,
    source_id,
    paypal_capture_id,
    paypal_request_id,
    refund_method,
    amount,
    original_amount,
    reason,
    status,
    initiated_by,
    initiated_by_type
  ) VALUES (
    p_source_type,
    p_source_id,
    p_paypal_capture_id,
    p_paypal_request_id,
    p_refund_method,
    p_amount,
    p_original_amount,
    p_reason,
    'pending',
    p_initiated_by,
    'staff'
  ) RETURNING id INTO v_new_id;

  -- 5. Return the new row ID and the remaining balance AFTER this reservation
  v_remaining := v_remaining - p_amount;
  RETURN QUERY SELECT v_new_id, v_remaining;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.apply_balance_payment_status(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total        numeric;
  v_paid         numeric;
  v_remaining    numeric;
  v_last_method  text;
BEGIN
  v_total := public.get_booking_gross_total(p_booking_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.private_booking_payments WHERE booking_id = p_booking_id;

  v_remaining := GREATEST(0, v_total - v_paid);

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
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total NUMERIC;
  v_payments_sum NUMERIC;
BEGIN
  v_total := public.get_booking_gross_total(p_booking_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_payments_sum
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  RETURN GREATEST(0, v_total - v_payments_sum);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_private_booking_invoice_atomic(p_booking_id uuid, p_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking      public.private_bookings%ROWTYPE;
  v_invoice      public.invoices%ROWTYPE;
  v_real_payments integer;
  v_reason       text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_note         text;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'cancel_reason_required';
  END IF;

  -- 1. Lock the booking so a concurrent generate cannot race this cancel.
  SELECT * INTO v_booking
  FROM public.private_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF v_booking.invoice_id IS NULL THEN
    RAISE EXCEPTION 'booking_not_invoiced';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_booking.invoice_id
  FOR UPDATE;

  -- A deleted invoice still leaves the booking linked and stuck. Release the
  -- booking rather than refusing, then stop: there is nothing left to void.
  IF NOT FOUND OR v_invoice.deleted_at IS NOT NULL THEN
    UPDATE public.private_bookings
    SET invoice_id = NULL,
        invoice_sent_at = NULL,
        invoice_deposit_treatment = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    RETURN jsonb_build_object(
      'unlinked', true,
      'voided', false,
      'invoice_number', NULL,
      'released_amount', 0
    );
  END IF;

  -- 2. Real money blocks the cancel. The mirrored deposit does not: it was
  --    written by the invoicing RPC, not received against this invoice.
  SELECT count(*) INTO v_real_payments
  FROM public.invoice_payments
  WHERE invoice_id = v_invoice.id
    AND source_kind IS DISTINCT FROM 'booking_deposit';

  IF v_real_payments > 0 THEN
    RAISE EXCEPTION 'invoice_has_real_payments';
  END IF;

  -- 3. Drop the mirrored deposit so the void invoice does not keep reporting
  --    money as paid against it. The deposit itself is untouched: it lives on
  --    private_bookings.deposit_amount and is re-mirrored onto the next invoice.
  DELETE FROM public.invoice_payments
  WHERE invoice_id = v_invoice.id
    AND source_kind = 'booking_deposit';

  -- 4. Void the invoice, keeping the reason and who did it on the record.
  --    The audit log holds the same facts; this puts them where anyone reading
  --    the invoice itself will see them.
  v_note := format('[VOIDED %s by %s] Reason: %s', now(), COALESCE(p_actor_id::text, 'unknown'), v_reason);

  UPDATE public.invoices
  SET status = 'void',
      paid_amount = 0,
      internal_notes = CASE
        WHEN COALESCE(btrim(internal_notes), '') = '' THEN v_note
        ELSE internal_notes || E'\n\n' || v_note
      END,
      updated_at = now()
  WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  -- 5. Release the booking. Clearing invoice_id is what re-opens the generate
  --    flow, because the RPC's idempotent short circuit keys off exactly this.
  UPDATE public.private_bookings
  SET invoice_id = NULL,
      invoice_sent_at = NULL,
      invoice_deposit_treatment = NULL,
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'unlinked', true,
    'voided', true,
    'invoice_number', v_invoice.invoice_number,
    'released_amount', v_invoice.total_amount
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_private_booking_invoice_atomic(p_booking_id uuid, p_invoice_date date, p_due_date date, p_reference text, p_deposit_treatment text, p_line_items jsonb, p_totals jsonb, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_booking          public.private_bookings;
  v_invoice          public.invoices;
  v_existing         public.invoices;
  v_items_total      numeric;
  v_gross_total      numeric;
  v_claimed_total    numeric;
  v_deposit          numeric := 0;
  v_paid             numeric := 0;
  v_status           text;
  v_line_count       integer;
  v_sequence         integer;
  v_number           integer;
  v_remainder        integer;
  v_encoded          text := '';
  v_invoice_number   text;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'create');

  IF p_deposit_treatment NOT IN ('held_separately', 'deducted') THEN
    RAISE EXCEPTION 'invalid_deposit_treatment';
  END IF;

  -- 1. Lock the source row first. This, not any index, is the double-click guard.
  SELECT * INTO v_booking
  FROM public.private_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  -- 2. Idempotent short circuit. A second call returns the first invoice.
  IF v_booking.invoice_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.invoices
    WHERE id = v_booking.invoice_id;

    IF NOT FOUND OR v_existing.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'private_booking_invoice_missing_or_deleted';
    END IF;

    RETURN jsonb_build_object('created', false, 'invoice', to_jsonb(v_existing));
  END IF;

  -- 3. Recheck eligibility under the lock.
  -- `status` is the authoritative field, not `cancelled_at`.
  --
  -- `cancelled_at` is stamped when a booking is cancelled and, until the
  -- companion fix in this migration set, was never cleared when one was
  -- reinstated. Three live confirmed bookings therefore carried a cancellation
  -- date from months earlier and could not be invoiced, even though the status
  -- said confirmed and the customer was owed an invoice.
  --
  -- Order matters: test for 'cancelled' first so a genuinely cancelled booking
  -- still gets its specific message rather than the generic "not confirmed".
  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'booking_cancelled';
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'booking_not_confirmed';
  END IF;

  IF v_booking.date_tbd THEN
    RAISE EXCEPTION 'booking_date_tbd';
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
  FROM public.private_booking_items
  WHERE booking_id = p_booking_id;

  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'booking_has_no_priced_items';
  END IF;

  v_line_count := COALESCE(jsonb_array_length(p_line_items), 0);
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'booking_has_no_priced_items';
  END IF;

  -- 4. The arithmetic guard. The customer already holds this figure on their
  --    contract and by SMS, so the invoice must match it to the penny.
  v_gross_total   := public.get_booking_gross_total(p_booking_id);
  v_claimed_total := (p_totals->>'total_amount')::numeric;

  IF v_claimed_total IS DISTINCT FROM v_gross_total THEN
    RAISE EXCEPTION 'invoice_total_reconciliation_failed: mapper produced %, booking gross is %',
      v_claimed_total, v_gross_total;
  END IF;

  -- 5. Invoice number. Same series and encoding as every other invoice.
  SELECT next_sequence INTO v_sequence
  FROM public.get_and_increment_invoice_series('INV')
  LIMIT 1;

  v_number := v_sequence + 5000;

  IF v_number = 0 THEN
    v_encoded := '0';
  END IF;

  WHILE v_number > 0 LOOP
    v_remainder := v_number % 36;
    v_encoded := substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', v_remainder + 1, 1) || v_encoded;
    v_number := floor(v_number / 36);
  END LOOP;

  v_invoice_number := 'INV-' || lpad(v_encoded, 5, '0');

  -- 6. The invoice header. Status is corrected at step 10 once payments land.
  INSERT INTO public.invoices (
    invoice_number,
    vendor_id,
    invoice_date,
    due_date,
    reference,
    invoice_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  )
  VALUES (
    v_invoice_number,
    (p_totals->>'vendor_id')::uuid,
    p_invoice_date,
    p_due_date,
    NULLIF(btrim(COALESCE(p_reference, '')), ''),
    COALESCE((p_totals->>'invoice_discount_percentage')::numeric, 0),
    (p_totals->>'subtotal_amount')::numeric,
    COALESCE((p_totals->>'discount_amount')::numeric, 0),
    (p_totals->>'vat_amount')::numeric,
    v_gross_total,
    p_totals->>'notes',
    p_totals->>'internal_notes',
    'draft'
  )
  RETURNING * INTO v_invoice;

  -- 7. Line items. The four money columns are GENERATED ALWAYS in this schema
  --    and must never be named here.
  INSERT INTO public.invoice_line_items (
    invoice_id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate,
    display_order
  )
  SELECT
    v_invoice.id,
    NULLIF(item->>'catalog_item_id', '')::uuid,
    item->>'description',
    (item->>'quantity')::numeric,
    (item->>'unit_price')::numeric,
    COALESCE((item->>'discount_percentage')::numeric, 0),
    COALESCE((item->>'vat_rate')::numeric, 20),
    COALESCE((item->>'display_order')::integer, ordinality::integer)
  FROM jsonb_array_elements(p_line_items) WITH ORDINALITY AS t(item, ordinality);

  -- 8. Copy every balance payment already recorded on the booking.
  --    Method mapping matters: private_booking_payments allows
  --    cash|card|invoice, invoice_payments allows
  --    bank_transfer|cash|cheque|card|other. 'invoice' would violate the
  --    invoice-side CHECK, and would do so AFTER the number was burnt.
  INSERT INTO public.invoice_payments (
    invoice_id,
    payment_date,
    amount,
    payment_method,
    reference,
    notes,
    source_payment_id,
    source_kind
  )
  SELECT
    v_invoice.id,
    (p.created_at AT TIME ZONE 'Europe/London')::date,
    p.amount,
    CASE p.method
      WHEN 'cash' THEN 'cash'
      WHEN 'card' THEN 'card'
      ELSE 'other'
    END,
    'Booking payment',
    p.notes,
    p.id,
    'booking_payment'
  FROM public.private_booking_payments p
  WHERE p.booking_id = p_booking_id
  ON CONFLICT (invoice_id, source_payment_id) WHERE source_payment_id IS NOT NULL
  DO NOTHING;

  -- 9. The deposit, only when the operator chose to apply it.
  --    Written as a PAYMENT, never as a discount: the supply is still the full
  --    amount, so a discount would understate the VAT.
  IF p_deposit_treatment = 'deducted'
     AND v_booking.deposit_paid_date IS NOT NULL
     AND COALESCE(v_booking.deposit_waived, false) = false
     AND COALESCE(v_booking.deposit_amount, 0) > 0 THEN

    v_deposit := v_booking.deposit_amount;

    INSERT INTO public.invoice_payments (
      invoice_id,
      payment_date,
      amount,
      payment_method,
      reference,
      notes,
      source_kind
    )
    VALUES (
      v_invoice.id,
      (v_booking.deposit_paid_date AT TIME ZONE 'Europe/London')::date,
      v_deposit,
      CASE COALESCE(v_booking.deposit_payment_method, '')
        WHEN 'cash' THEN 'cash'
        WHEN 'card' THEN 'card'
        ELSE 'other'
      END,
      'Booking and damage deposit',
      'Deposit applied to this invoice at the operator''s instruction.',
      'booking_deposit'
    )
    ON CONFLICT (invoice_id) WHERE source_kind = 'booking_deposit'
    DO NOTHING;
  END IF;

  -- 10. Derive paid_amount from the rows, never by incrementing.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.invoice_payments
  WHERE invoice_id = v_invoice.id;

  IF v_paid > v_gross_total THEN
    RAISE EXCEPTION 'booking_payments_exceed_invoice_total: paid % exceeds total %',
      v_paid, v_gross_total;
  END IF;

  v_status := CASE
    WHEN v_gross_total > 0 AND v_paid >= v_gross_total THEN 'paid'
    WHEN v_paid > 0 THEN 'partially_paid'
    ELSE 'draft'
  END;

  UPDATE public.invoices
  SET paid_amount = v_paid,
      status = v_status,
      updated_at = now()
  WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  -- 11. Claim the booking. The conditional WHERE is what makes two concurrent
  --     callers resolve to one invoice even if both got past step 2.
  UPDATE public.private_bookings
  SET invoice_id = v_invoice.id,
      invoice_deposit_treatment = p_deposit_treatment,
      updated_at = now()
  WHERE id = p_booking_id
    AND invoice_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking invoice could not be finalized';
  END IF;

  RETURN jsonb_build_object(
    'created', true,
    'invoice', to_jsonb(v_invoice),
    'deposit_applied', v_deposit,
    'deposit_treatment', p_deposit_treatment
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_balance_payment(p_booking_id uuid, p_amount numeric, p_method text, p_recorded_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_booking RECORD;
  v_gross_total NUMERIC;
  v_payments_total NUMERIC;
  v_remaining NUMERIC;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits') THEN
    RAISE EXCEPTION 'Permission denied: manage_deposits required';
  END IF;

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

  IF v_booking.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot record payment on a % booking', v_booking.status;
  END IF;

  v_gross_total := public.get_booking_gross_total(p_booking_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_payments_total
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  v_remaining := GREATEST(0, v_gross_total - v_payments_total);
  IF p_amount > v_remaining + 0.005 THEN
    RAISE EXCEPTION 'Amount (%) exceeds remaining balance (%)', p_amount, v_remaining;
  END IF;

  INSERT INTO public.private_booking_payments (booking_id, amount, method, recorded_by)
  VALUES (p_booking_id, p_amount, p_method, p_recorded_by);

  v_payments_total := v_payments_total + p_amount;
  v_remaining := GREATEST(0, v_gross_total - v_payments_total);

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
$function$
;

CREATE OR REPLACE FUNCTION public.record_invoice_payment_transaction(p_payment_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payment_id UUID;
  v_invoice_id UUID;
  v_amount DECIMAL;
  v_current_paid DECIMAL;
  v_total DECIMAL;
  v_new_paid DECIMAL;
  v_new_status text; -- Changed from invoice_status to text
  v_payment_record JSONB;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'edit');

  v_invoice_id := (p_payment_data->>'invoice_id')::UUID;
  v_amount := (p_payment_data->>'amount')::DECIMAL;

  -- 1. Get current invoice details
  SELECT paid_amount, total_amount, status
  INTO v_current_paid, v_total, v_new_status
  FROM invoices
  WHERE id = v_invoice_id
  FOR UPDATE; -- Lock the row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_amount > (v_total - v_current_paid) THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding balance';
  END IF;

  -- 2. Insert Payment
  INSERT INTO invoice_payments (
    invoice_id,
    payment_date,
    amount,
    payment_method,
    reference,
    notes
  ) VALUES (
    v_invoice_id,
    (p_payment_data->>'payment_date')::DATE,
    v_amount,
    p_payment_data->>'payment_method',
    p_payment_data->>'reference',
    p_payment_data->>'notes'
  )
  RETURNING id INTO v_payment_id;

  -- 3. Update Invoice Status
  v_new_paid := v_current_paid + v_amount;

  IF v_new_paid >= v_total THEN
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
    v_new_status := 'partially_paid';
  END IF;

  UPDATE invoices
  SET
    paid_amount = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = v_invoice_id;

  -- 4. Return Payment Record
  SELECT to_jsonb(ip) INTO v_payment_record
  FROM invoice_payments ip
  WHERE ip.id = v_payment_id;

  RETURN v_payment_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_invoice_paypal_payment_atomic(p_invoice_id uuid, p_amount numeric, p_capture_id text, p_order_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_inserted uuid;
  v_paid numeric;
  v_status text;
BEGIN
  IF p_capture_id IS NULL OR btrim(p_capture_id) = '' THEN
    RAISE EXCEPTION 'capture_id_required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_payment_amount';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND OR v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  -- Money must never land on an invoice that has been withdrawn. If PayPal
  -- has already taken it, that is a refund, and a human has to make that call.
  IF v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'invoice_not_payable';
  END IF;

  -- The idempotent step. A capture already recorded returns quietly, so the
  -- webhook, the portal return and the cron can all race safely.
  INSERT INTO public.invoice_payments (
    invoice_id, payment_date, amount, payment_method, reference, notes, source_kind
  )
  VALUES (
    p_invoice_id,
    CURRENT_DATE,
    p_amount,
    'paypal',
    btrim(p_capture_id),
    'Paid online by the customer via PayPal.',
    'paypal'
  )
  ON CONFLICT (reference) WHERE source_kind = 'paypal'
  DO NOTHING
  RETURNING id INTO v_inserted;

  -- Derive from the rows, never by incrementing, so a double call cannot drift.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  v_status := CASE
    WHEN COALESCE(v_invoice.total_amount, 0) > 0 AND v_paid >= v_invoice.total_amount THEN 'paid'
    WHEN v_paid > 0 THEN 'partially_paid'
    ELSE v_invoice.status
  END;

  UPDATE public.invoices
  SET paid_amount = v_paid,
      status = v_status,
      -- Retire the order once settled so nothing keeps polling it.
      paypal_order_id = CASE WHEN v_status = 'paid' THEN NULL ELSE paypal_order_id END,
      paypal_reconciliation_attempts = CASE WHEN v_status = 'paid' THEN 0 ELSE paypal_reconciliation_attempts END,
      paypal_reconciliation_last_error = CASE WHEN v_status = 'paid' THEN NULL ELSE paypal_reconciliation_last_error END,
      updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'recorded', v_inserted IS NOT NULL,
    'already_recorded', v_inserted IS NULL,
    'paid_amount', v_paid,
    'status', v_status,
    'invoice_number', v_invoice.invoice_number
  );
END;
$function$
;

CREATE VIEW public.private_bookings_with_details WITH (security_invoker = on) AS
 SELECT pb.id,
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
    pb.date_tbd,
    c.mobile_number AS customer_mobile,
    get_booking_discounted_total(pb.id) AS calculated_total,
        CASE
            WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
            WHEN COALESCE(pb.deposit_amount, 0::numeric) <= 0::numeric THEN 'Not Required'::text
            WHEN pb.status = 'confirmed'::text THEN 'Required'::text
            ELSE 'Not Required'::text
        END AS deposit_status,
    pb.event_date - CURRENT_DATE AS days_until_event,
    pb.contract_note,
    pb.hold_expiry,
    ( SELECT COALESCE(sum(pbp.amount), 0::numeric) AS "coalesce"
           FROM private_booking_payments pbp
          WHERE pbp.booking_id = pb.id) AS total_balance_paid,
    calculate_private_booking_balance(pb.id) AS balance_remaining,
        CASE
            WHEN calculate_private_booking_balance(pb.id) <= 0::numeric THEN 'Fully Paid'::text
            WHEN (( SELECT COALESCE(sum(pbp.amount), 0::numeric) AS "coalesce"
               FROM private_booking_payments pbp
              WHERE pbp.booking_id = pb.id)) > 0::numeric THEN 'Partially Paid'::text
            ELSE 'Unpaid'::text
        END AS payment_status,
    get_booking_vat_amount(pb.id) AS vat_amount,
    get_booking_gross_total(pb.id) AS gross_total
   FROM private_bookings pb
     LEFT JOIN customers c ON pb.customer_id = c.id;
