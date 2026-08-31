-- Invoicing was refused on three live bookings that say "confirmed".
--
-- The guard below tested `cancelled_at IS NOT NULL` as well as the status. That
-- timestamp is written on cancellation and was never cleared on reinstatement,
-- so Lisa Andrew (3 Sep), Chloe Weightman (24 Sep) and Lorna Wright (21 Nov)
-- all carried a stale cancellation date and could not be invoiced.
--
-- Two halves to the fix: the function now reads `status` only (below), and the
-- reinstate path clears the timestamp so the data stops drifting. The stale
-- rows are cleared by the accompanying backfill migration.
--
-- The whole function is re-created because PL/pgSQL has no partial replace.
-- Only the guard block changed. The EXECUTE grants are re-issued below, which
-- a CREATE OR REPLACE of a SECURITY DEFINER routine must always do here: an
-- event trigger strips the built-in PUBLIC grant from any replaced definer
-- routine, and a deliberate grant issued afterwards is what wins.

CREATE OR REPLACE FUNCTION public.create_private_booking_invoice_atomic(
  p_booking_id        uuid,
  p_invoice_date      date,
  p_due_date          date,
  p_reference         text,
  p_deposit_treatment text,
  p_line_items        jsonb,
  p_totals            jsonb,
  p_actor_id          uuid
)
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
$function$;

-- New public functions are granted EXECUTE to PUBLIC by default in this
-- project, and anon is a member of PUBLIC. There is no ALTER DEFAULT
-- PRIVILEGES rule and no CI assertion, so this revoke has to be explicit and
-- has to live in the same migration as the CREATE.
REVOKE ALL ON FUNCTION public.create_private_booking_invoice_atomic(
  uuid, date, date, text, text, jsonb, jsonb, uuid
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.create_private_booking_invoice_atomic(
  uuid, date, date, text, text, jsonb, jsonb, uuid
) TO service_role;

COMMENT ON FUNCTION public.create_private_booking_invoice_atomic(
  uuid, date, date, text, text, jsonb, jsonb, uuid
) IS
  'Atomically creates an invoice for a private booking, copies its balance payments, optionally applies the deposit, and links the booking. Idempotent: a second call returns the existing invoice. Service role only.';
