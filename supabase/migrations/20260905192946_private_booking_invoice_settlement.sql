-- Production target: tfcasgxopxegwrabvwat. Draft only until separately approved.
-- Preserve both ledgers. Booking payments are mirrored one way onto invoices;
-- invoice-origin payments contribute to the booking without being copied back.
SET lock_timeout = '5s';

ALTER TABLE public.invoice_payments
  DROP CONSTRAINT invoice_payments_payment_method_check,
  ADD CONSTRAINT invoice_payments_payment_method_check
    CHECK (payment_method IN ('bank_transfer', 'cash', 'cheque', 'card', 'other', 'paypal')),
  DROP CONSTRAINT invoice_payments_source_kind_check,
  ADD CONSTRAINT invoice_payments_source_kind_check
    CHECK (source_kind IN ('booking_payment', 'booking_deposit', 'paypal'));

CREATE OR REPLACE FUNCTION public.private_booking_settlement_rows(p_booking_id uuid)
RETURNS TABLE(amount numeric, paid_at timestamptz, method text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT p.amount::numeric, p.created_at::timestamptz, p.method::text
  FROM public.private_booking_payments p WHERE p.booking_id = p_booking_id
  UNION ALL
  SELECT p.amount::numeric,
         (p.payment_date::timestamp AT TIME ZONE 'Europe/London')::timestamptz,
         p.payment_method::text
  FROM public.private_bookings b
  JOIN public.invoice_payments p ON p.invoice_id = b.invoice_id
  WHERE b.id = p_booking_id
    AND (p.source_kind IS NULL OR p.source_kind NOT IN ('booking_payment', 'booking_deposit')
         OR (p.source_kind = 'booking_deposit' AND b.invoice_deposit_treatment = 'deducted'));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_private_booking_settlement_total(p_booking_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.assert_rpc_permission('private_bookings', 'view');
  RETURN COALESCE((SELECT SUM(amount) FROM public.private_booking_settlement_rows(p_booking_id)), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.assert_rpc_permission('private_bookings', 'view');
  RETURN GREATEST(0, public.get_booking_gross_total(p_booking_id)
    - COALESCE((SELECT SUM(amount) FROM public.private_booking_settlement_rows(p_booking_id)), 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_balance_payment_status(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_paid numeric;
  v_total numeric;
  v_date timestamptz;
  v_method text;
BEGIN
  PERFORM 1 FROM public.private_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_total := public.get_booking_gross_total(p_booking_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.private_booking_settlement_rows(p_booking_id);
  IF v_total > 0 AND v_paid >= v_total THEN
    SELECT paid_at, method INTO v_date, v_method
    FROM public.private_booking_settlement_rows(p_booking_id)
    ORDER BY paid_at DESC NULLS LAST, method LIMIT 1;
  END IF;
  UPDATE public.private_bookings
  SET final_payment_date = v_date, final_payment_method = v_method
  WHERE id = p_booking_id
    AND (final_payment_date IS DISTINCT FROM v_date OR final_payment_method IS DISTINCT FROM v_method);
END;
$$;

-- All entry points take the booking lock before the invoice lock. Do not add
-- invoice-to-booking writes to a caller that already locked the invoice first.
CREATE OR REPLACE FUNCTION public.lock_invoice_settlement(p_invoice_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_booking_id uuid;
BEGIN
  SELECT id INTO v_booking_id FROM public.private_bookings
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  PERFORM 1 FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  RETURN v_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_invoice_settlement(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_booking_id uuid; v_paid numeric;
BEGIN
  v_booking_id := public.lock_invoice_settlement(p_invoice_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.invoice_payments WHERE invoice_id = p_invoice_id;
  UPDATE public.invoices
  SET paid_amount = v_paid,
      status = CASE
        WHEN status IN ('void', 'written_off') THEN status
        WHEN total_amount > 0 AND v_paid >= total_amount THEN 'paid'
        WHEN v_paid > 0 THEN 'partially_paid'
        WHEN sent_at IS NULL THEN 'draft'
        WHEN due_date < (now() AT TIME ZONE 'Europe/London')::date THEN 'overdue'
        ELSE 'sent' END,
      updated_at = now()
  WHERE id = p_invoice_id;
  IF v_booking_id IS NOT NULL THEN PERFORM public.apply_balance_payment_status(v_booking_id); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_invoice_payment_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_invoice public.invoices%ROWTYPE; v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'payment_invoice_cannot_change';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  PERFORM public.lock_invoice_settlement(v_id);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_id;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_kind = 'paypal' THEN
    IF TG_OP = 'DELETE' OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      RAISE EXCEPTION 'PayPal captures cannot be changed or deleted; resolve a refund or credit';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_kind = 'booking_payment' THEN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'Edit or delete the original booking payment';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.source_kind IS DISTINCT FROM OLD.source_kind
      OR NEW.source_payment_id IS DISTINCT FROM OLD.source_payment_id) THEN
      RAISE EXCEPTION 'Edit or delete the original booking payment';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.source_kind = 'booking_payment' THEN
    IF NOT EXISTS (SELECT 1 FROM public.private_booking_payments p
      WHERE p.id = NEW.source_payment_id AND p.amount = NEW.amount
        AND NOT EXISTS (SELECT 1 FROM public.private_bookings b WHERE b.invoice_id = NEW.invoice_id AND b.id <> p.booking_id)
        AND (p.created_at AT TIME ZONE 'Europe/London')::date = NEW.payment_date
        AND (CASE WHEN p.method IN ('cash','card') THEN p.method ELSE 'other' END) = NEW.payment_method
        AND p.notes IS NOT DISTINCT FROM NEW.notes) THEN
      RAISE EXCEPTION 'Edit or delete the original booking payment';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_kind = 'booking_deposit'
     AND EXISTS (SELECT 1 FROM public.private_bookings WHERE invoice_id = v_id AND invoice_deposit_treatment = 'deducted') THEN
    RAISE EXCEPTION 'Applied deposit requires invoice credit resolution';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
      RAISE EXCEPTION 'invoice_not_payable';
    END IF;
    IF NEW.amount IS NULL OR NEW.amount::text IN ('NaN', 'Infinity', '-Infinity') OR NEW.amount <= 0 OR NEW.amount <> round(NEW.amount, 2) THEN
      RAISE EXCEPTION 'invalid_payment_amount';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.after_invoice_payment_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.recalculate_invoice_settlement(CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END);
  RETURN NULL;
END;
$$;

CREATE TRIGGER invoice_payment_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_payment_settlement();
CREATE TRIGGER invoice_payment_settlement_changed AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.after_invoice_payment_settlement();

CREATE OR REPLACE FUNCTION public.guard_private_booking_payment_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_booking public.private_bookings%ROWTYPE; v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    RAISE EXCEPTION 'payment_booking_cannot_change';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
  SELECT * INTO v_booking FROM public.private_bookings WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.invoice_id IS NOT NULL THEN
    PERFORM public.lock_invoice_settlement(v_booking.invoice_id);
    IF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_booking.invoice_id
               AND (deleted_at IS NOT NULL OR status IN ('void', 'written_off'))) THEN
      RAISE EXCEPTION 'invoice_not_payable';
    END IF;
  END IF;
  -- Delete the mirror before the foreign key can replace its source id with NULL.
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.invoice_payments WHERE source_kind = 'booking_payment' AND source_payment_id = OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_private_booking_payment_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_invoice_id uuid; v_booking_id uuid;
BEGIN
  v_booking_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
  SELECT invoice_id INTO v_invoice_id FROM public.private_bookings WHERE id = v_booking_id;
  IF TG_OP <> 'DELETE' AND v_invoice_id IS NOT NULL THEN
    INSERT INTO public.invoice_payments(invoice_id, payment_date, amount, payment_method, reference, notes, source_payment_id, source_kind)
    VALUES(v_invoice_id, (NEW.created_at AT TIME ZONE 'Europe/London')::date, NEW.amount,
      CASE WHEN NEW.method IN ('cash', 'card') THEN NEW.method ELSE 'other' END,
      'Booking payment', NEW.notes, NEW.id, 'booking_payment')
    ON CONFLICT (invoice_id, source_payment_id) WHERE source_payment_id IS NOT NULL
    DO UPDATE SET amount = EXCLUDED.amount, payment_date = EXCLUDED.payment_date,
      payment_method = EXCLUDED.payment_method, notes = EXCLUDED.notes;
  END IF;
  PERFORM public.apply_balance_payment_status(v_booking_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER private_booking_payment_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.private_booking_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_private_booking_payment_settlement();
CREATE TRIGGER private_booking_payment_settlement_changed AFTER INSERT OR UPDATE OR DELETE ON public.private_booking_payments
FOR EACH ROW EXECUTE FUNCTION public.sync_private_booking_payment_settlement();

CREATE OR REPLACE FUNCTION public.after_private_booking_invoice_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.invoice_payments ip
    LEFT JOIN public.private_booking_payments bp ON bp.id = ip.source_payment_id
    WHERE ip.invoice_id = NEW.invoice_id AND ip.source_kind = 'booking_payment'
      AND bp.booking_id IS DISTINCT FROM NEW.id
  ) THEN RAISE EXCEPTION 'Invoice mirror belongs to another booking'; END IF;
  PERFORM public.apply_balance_payment_status(NEW.id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER private_booking_invoice_link_changed AFTER UPDATE OF invoice_id, invoice_deposit_treatment ON public.private_bookings
FOR EACH ROW WHEN (OLD.invoice_id IS DISTINCT FROM NEW.invoice_id OR OLD.invoice_deposit_treatment IS DISTINCT FROM NEW.invoice_deposit_treatment)
EXECUTE FUNCTION public.after_private_booking_invoice_link();

-- Five explicit arguments avoid ambiguous default overload resolution in PostgREST.
CREATE OR REPLACE FUNCTION public.record_invoice_paypal_payment_atomic(
  p_invoice_id uuid, p_amount numeric, p_capture_id text, p_order_id text, p_captured_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_existing public.invoice_payments%ROWTYPE;
  v_booking_id uuid;
  v_inserted uuid;
BEGIN
  IF NULLIF(btrim(p_capture_id), '') IS NULL THEN RAISE EXCEPTION 'capture_id_required'; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'invalid_payment_amount';
  END IF;
  v_booking_id := public.lock_invoice_settlement(p_invoice_id);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'invoice_not_payable';
  END IF;
  INSERT INTO public.invoice_payments(invoice_id, payment_date, amount, payment_method, reference, notes, source_kind)
  VALUES(p_invoice_id, (COALESCE(p_captured_at, now()) AT TIME ZONE 'Europe/London')::date,
    p_amount, 'paypal', btrim(p_capture_id), 'Paid online by the customer via PayPal.', 'paypal')
  ON CONFLICT (reference) WHERE source_kind = 'paypal' DO NOTHING RETURNING id INTO v_inserted;
  IF v_inserted IS NULL THEN
    SELECT * INTO v_existing FROM public.invoice_payments
    WHERE source_kind = 'paypal' AND reference = btrim(p_capture_id);
    IF v_existing.invoice_id IS DISTINCT FROM p_invoice_id OR v_existing.amount IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'paypal_capture_conflict';
    END IF;
    PERFORM public.recalculate_invoice_settlement(p_invoice_id);
  END IF;
  UPDATE public.invoices
  SET paypal_order_id = CASE WHEN status = 'paid' THEN NULL ELSE paypal_order_id END,
      paypal_reconciliation_attempts = CASE WHEN status = 'paid' THEN 0 ELSE paypal_reconciliation_attempts END,
      paypal_reconciliation_last_error = CASE WHEN status = 'paid' THEN NULL ELSE paypal_reconciliation_last_error END
  WHERE id = p_invoice_id RETURNING * INTO v_invoice;
  RETURN jsonb_build_object('recorded', v_inserted IS NOT NULL, 'already_recorded', v_inserted IS NULL,
    'paid_amount', v_invoice.paid_amount, 'status', v_invoice.status,
    'invoice_number', v_invoice.invoice_number, 'private_booking_id', v_booking_id,
    'overpaid_amount', GREATEST(0, v_invoice.paid_amount - v_invoice.total_amount));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_paypal_payment_atomic(
  p_invoice_id uuid, p_amount numeric, p_capture_id text, p_order_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT public.record_invoice_paypal_payment_atomic(p_invoice_id, p_amount, p_capture_id, p_order_id, NULL::timestamptz);
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment_transaction(p_payment_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_invoice public.invoices%ROWTYPE; v_payment public.invoice_payments%ROWTYPE;
  v_invoice_id uuid := (p_payment_data->>'invoice_id')::uuid;
  v_amount numeric := (p_payment_data->>'amount')::numeric;
  v_paid numeric;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'edit');
  PERFORM public.lock_invoice_settlement(v_invoice_id);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_invoice_id;
  IF v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'invoice_not_payable';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.invoice_payments WHERE invoice_id = v_invoice_id;
  IF v_amount IS NULL OR v_amount::text IN ('NaN', 'Infinity', '-Infinity') OR v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  IF v_amount > v_invoice.total_amount - v_paid THEN RAISE EXCEPTION 'Payment amount exceeds outstanding balance'; END IF;
  INSERT INTO public.invoice_payments(invoice_id, payment_date, amount, payment_method, reference, notes)
  VALUES(v_invoice_id, (p_payment_data->>'payment_date')::date, v_amount,
    p_payment_data->>'payment_method', p_payment_data->>'reference', p_payment_data->>'notes')
  RETURNING * INTO v_payment;
  RETURN to_jsonb(v_payment);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_balance_payment(p_booking_id uuid, p_amount numeric, p_method text, p_recorded_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_status text; v_remaining numeric; v_paid numeric;
BEGIN
  PERFORM public.assert_rpc_permission('private_bookings', 'manage_deposits');
  SELECT status INTO v_status FROM public.private_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found: %', p_booking_id; END IF;
  IF v_status IN ('cancelled', 'completed') THEN RAISE EXCEPTION 'Cannot record payment on a % booking', v_status; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  v_remaining := public.calculate_private_booking_balance(p_booking_id);
  IF p_amount > v_remaining THEN RAISE EXCEPTION 'Amount (%) exceeds remaining balance (%)', p_amount, v_remaining; END IF;
  INSERT INTO public.private_booking_payments(booking_id, amount, method, recorded_by)
  VALUES(p_booking_id, p_amount, p_method, p_recorded_by);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.private_booking_settlement_rows(p_booking_id);
  v_remaining := public.calculate_private_booking_balance(p_booking_id);
  RETURN jsonb_build_object('booking_id', p_booking_id, 'total_paid', v_paid,
    'remaining_balance', v_remaining, 'is_fully_paid', v_remaining = 0);
END;
$$;

-- No new permission surface. Read helpers respect the caller's existing RLS.
REVOKE ALL ON FUNCTION public.private_booking_settlement_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_booking_settlement_rows(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_private_booking_settlement_total(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_booking_settlement_total(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.calculate_private_booking_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_private_booking_balance(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_balance_payment_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_balance_payment_status(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lock_invoice_settlement(uuid), public.recalculate_invoice_settlement(uuid),
  public.guard_invoice_payment_settlement(), public.after_invoice_payment_settlement(),
  public.guard_private_booking_payment_settlement(), public.sync_private_booking_payment_settlement(),
  public.after_private_booking_invoice_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_invoice_settlement(uuid), public.recalculate_invoice_settlement(uuid),
  public.guard_invoice_payment_settlement(), public.after_invoice_payment_settlement(),
  public.guard_private_booking_payment_settlement(), public.sync_private_booking_payment_settlement(),
  public.after_private_booking_invoice_link() TO service_role;
REVOKE ALL ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text),
  public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text),
  public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.record_invoice_payment_transaction(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment_transaction(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_balance_payment(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_balance_payment(uuid, numeric, text, uuid) TO service_role;

-- Keep the existing view's columns, order, grants and invoker RLS behaviour.
CREATE OR REPLACE VIEW public.private_bookings_with_details WITH (security_invoker = on) AS
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
    public.get_private_booking_settlement_total(pb.id) AS total_balance_paid,
    calculate_private_booking_balance(pb.id) AS balance_remaining,
        CASE
            WHEN calculate_private_booking_balance(pb.id) <= 0::numeric THEN 'Fully Paid'::text
            WHEN (public.get_private_booking_settlement_total(pb.id)) > 0::numeric THEN 'Partially Paid'::text
            ELSE 'Unpaid'::text
        END AS payment_status,
    get_booking_vat_amount(pb.id) AS vat_amount,
    get_booking_gross_total(pb.id) AS gross_total
   FROM private_bookings pb
     LEFT JOIN customers c ON pb.customer_id = c.id;
REVOKE ALL ON public.private_bookings_with_details FROM anon;
GRANT SELECT ON public.private_bookings_with_details TO authenticated, service_role;

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

  IF NOT FOUND OR v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'private_booking_invoice_missing_or_deleted';
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

  IF v_invoice.paypal_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Resolve the pending PayPal order before cancelling the invoice';
  END IF;

  UPDATE public.private_bookings
  SET invoice_id = NULL, invoice_sent_at = NULL, invoice_deposit_treatment = NULL, updated_at = now()
  WHERE id = p_booking_id;

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
REVOKE ALL ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) TO service_role;

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
  IF p_source_type = 'private_booking' THEN
    PERFORM 1 FROM public.private_bookings WHERE id = p_source_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.private_bookings
      WHERE id = p_source_id AND invoice_id IS NOT NULL AND invoice_deposit_treatment = 'deducted') THEN
      RAISE EXCEPTION 'Applied deposit requires invoice credit resolution';
    END IF;
  END IF;

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
  RETURN QUERY SELECT v_new_id::uuid, v_remaining::numeric;
END;
$function$
;
REVOKE ALL ON FUNCTION public.reserve_refund_balance(text, uuid, numeric, numeric, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund_balance(text, uuid, numeric, numeric, text, text, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_private_booking_invoice_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND (NEW.discount_type IS DISTINCT FROM OLD.discount_type
      OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.total_amount IS DISTINCT FROM OLD.total_amount) THEN
      RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
    END IF;
    IF TG_OP = 'DELETE' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
      IF EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = OLD.invoice_id
                 AND source_kind IS DISTINCT FROM 'booking_deposit') THEN
        RAISE EXCEPTION 'invoice_has_real_payments';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
       AND OLD.invoice_deposit_treatment = 'deducted'
       AND (NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount
         OR NEW.deposit_paid_date IS DISTINCT FROM OLD.deposit_paid_date
         OR NEW.deposit_waived IS DISTINCT FROM OLD.deposit_waived
         OR NEW.invoice_deposit_treatment IS DISTINCT FROM OLD.invoice_deposit_treatment) THEN
      RAISE EXCEPTION 'Applied deposit requires invoice credit resolution';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER private_booking_invoice_money_guard BEFORE UPDATE OR DELETE ON public.private_bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_private_booking_invoice_money();

CREATE OR REPLACE FUNCTION public.guard_linked_invoice_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.invoice_discount_percentage IS DISTINCT FROM OLD.invoice_discount_percentage
    OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount)
    AND EXISTS (SELECT 1 FROM public.private_bookings WHERE invoice_id = OLD.id) THEN
    RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
  END IF;
  IF TG_OP = 'DELETE' OR (NEW.status IN ('void', 'written_off') AND NEW.status IS DISTINCT FROM OLD.status)
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF EXISTS (SELECT 1 FROM public.private_bookings WHERE invoice_id = OLD.id) THEN
      RAISE EXCEPTION 'Cancel the invoice from its private booking after resolving its payments';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER linked_invoice_money_guard BEFORE UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_invoice_money();
REVOKE ALL ON FUNCTION public.guard_private_booking_invoice_money(), public.guard_linked_invoice_money() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_private_booking_invoice_money(), public.guard_linked_invoice_money() TO service_role;

CREATE OR REPLACE FUNCTION public.guard_linked_booking_item_prices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_booking_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
    AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
    AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
    AND NEW.discount_type IS NOT DISTINCT FROM OLD.discount_type
    AND NEW.discount_value IS NOT DISTINCT FROM OLD.discount_value
    AND NEW.vat_rate IS NOT DISTINCT FROM OLD.vat_rate THEN RETURN NEW; END IF;
  FOR v_booking_id IN SELECT id FROM public.private_bookings
    WHERE id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.booking_id END,
                 CASE WHEN TG_OP <> 'DELETE' THEN NEW.booking_id END)
    ORDER BY id FOR UPDATE LOOP
    IF EXISTS (SELECT 1 FROM public.private_bookings WHERE id = v_booking_id AND invoice_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER linked_booking_item_prices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.private_booking_items
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_booking_item_prices();

CREATE OR REPLACE FUNCTION public.guard_linked_invoice_item_prices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
    AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
    AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
    AND NEW.discount_percentage IS NOT DISTINCT FROM OLD.discount_percentage
    AND NEW.vat_rate IS NOT DISTINCT FROM OLD.vat_rate THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.private_bookings
    WHERE invoice_id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
                         CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END)) THEN
    RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER linked_invoice_item_prices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_invoice_item_prices();
REVOKE ALL ON FUNCTION public.guard_linked_booking_item_prices(), public.guard_linked_invoice_item_prices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_linked_booking_item_prices(), public.guard_linked_invoice_item_prices() TO service_role;

RESET lock_timeout;
