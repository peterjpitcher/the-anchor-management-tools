-- Rollback is safe only before feature data exists. After use, keep schema and forward-fix.
SET lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.private_booking_charge_batches) OR EXISTS(SELECT 1 FROM public.private_booking_payment_receipts) OR EXISTS(SELECT 1 FROM public.private_bookings WHERE receipt_version>0) THEN
 RAISE EXCEPTION 'Feature data exists: rollback refused; retain schema and forward-fix'; END IF;
END $$;
DROP POLICY booking_receipt_document_read_guard ON public.private_booking_documents;
DROP POLICY booking_receipt_document_insert_guard ON public.private_booking_documents;
DROP POLICY booking_receipt_document_update_guard ON public.private_booking_documents;
DROP POLICY booking_receipt_document_delete_guard ON public.private_booking_documents;
DROP FUNCTION public.claim_private_booking_extra_delivery(uuid,uuid,uuid,boolean);
DROP FUNCTION public.finish_private_booking_extra_delivery(uuid,uuid,uuid,boolean,text);
DROP TRIGGER booking_credit_settlement_guard ON public.credit_notes;
DROP TRIGGER booking_credit_settlement_changed ON public.credit_notes;
DROP TRIGGER private_booking_invoice_association ON public.private_bookings;

CREATE OR REPLACE FUNCTION public.private_booking_settlement_rows(p_booking_id uuid)
 RETURNS TABLE(amount numeric, paid_at timestamp with time zone, method text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.lock_invoice_settlement(p_invoice_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_booking_id uuid;
BEGIN
  SELECT id INTO v_booking_id FROM public.private_bookings
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  PERFORM 1 FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  RETURN v_booking_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.assert_rpc_permission('private_bookings', 'view');
  RETURN GREATEST(0, public.get_booking_gross_total(p_booking_id)
    - COALESCE((SELECT SUM(amount) FROM public.private_booking_settlement_rows(p_booking_id)), 0));
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_linked_invoice_money()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_linked_invoice_item_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_invoice_payment_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_private_booking_payment_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_invoice_settlement(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_credit_note_atomic(p_invoice_id uuid, p_amount_ex_vat numeric, p_reason text, p_created_by uuid)
 RETURNS TABLE(id uuid, credit_note_number text, amount_inc_vat numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_year integer := extract(year from timezone('Europe/London', now()))::integer;
  v_next_seq integer := 1;
  v_last_number text;
  v_vat_rate numeric;
  v_amount_inc_vat numeric;
  v_credit_note public.credit_notes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), 'invoices', 'create') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_created_by IS NULL OR p_created_by <> auth.uid() THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_invoice_id IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'invoice_id_and_reason_required';
  END IF;

  IF p_amount_ex_vat IS NULL OR p_amount_ex_vat <= 0 THEN
    RAISE EXCEPTION 'credit_note_amount_must_be_positive';
  END IF;

  SELECT *
    INTO v_invoice
    FROM public.invoices
   WHERE invoices.id = p_invoice_id
     AND invoices.deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  v_vat_rate := CASE
    WHEN coalesce(v_invoice.subtotal_amount, 0) > 0
      THEN round((coalesce(v_invoice.vat_amount, 0) / v_invoice.subtotal_amount) * 10000) / 100
    ELSE 20
  END;
  v_amount_inc_vat := round((p_amount_ex_vat * (1 + v_vat_rate / 100)) * 100) / 100;

  PERFORM pg_advisory_xact_lock(hashtext('credit_notes:' || v_year::text));

  SELECT cn.credit_note_number
    INTO v_last_number
    FROM public.credit_notes cn
   WHERE cn.credit_note_number ILIKE ('CN-' || v_year::text || '-%')
   ORDER BY cn.credit_note_number DESC
   LIMIT 1;

  IF v_last_number IS NOT NULL THEN
    v_next_seq := coalesce(substring(v_last_number from '^CN-[0-9]{4}-([0-9]+)$')::integer, 0) + 1;
  END IF;

  INSERT INTO public.credit_notes (
    credit_note_number,
    invoice_id,
    vendor_id,
    amount_ex_vat,
    vat_rate,
    amount_inc_vat,
    reason,
    status,
    created_by
  )
  VALUES (
    'CN-' || v_year::text || '-' || lpad(v_next_seq::text, 3, '0'),
    v_invoice.id,
    v_invoice.vendor_id,
    p_amount_ex_vat,
    v_vat_rate,
    v_amount_inc_vat,
    v_reason,
    'issued',
    p_created_by
  )
  RETURNING * INTO v_credit_note;

  RETURN QUERY SELECT
    v_credit_note.id,
    v_credit_note.credit_note_number,
    v_credit_note.amount_inc_vat;
END;
$function$
;

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

CREATE OR REPLACE VIEW public.private_bookings_with_details WITH(security_invoker=true) AS  SELECT pb.id,
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
            WHEN (pb.deposit_paid_date IS NOT NULL) THEN 'Paid'::text
            WHEN (COALESCE(pb.deposit_amount, (0)::numeric) <= (0)::numeric) THEN 'Not Required'::text
            WHEN (pb.status = 'confirmed'::text) THEN 'Required'::text
            ELSE 'Not Required'::text
        END AS deposit_status,
    (pb.event_date - CURRENT_DATE) AS days_until_event,
    pb.contract_note,
    pb.hold_expiry,
    get_private_booking_settlement_total(pb.id) AS total_balance_paid,
    calculate_private_booking_balance(pb.id) AS balance_remaining,
        CASE
            WHEN (calculate_private_booking_balance(pb.id) <= (0)::numeric) THEN 'Fully Paid'::text
            WHEN (get_private_booking_settlement_total(pb.id) > (0)::numeric) THEN 'Partially Paid'::text
            ELSE 'Unpaid'::text
        END AS payment_status,
    get_booking_vat_amount(pb.id) AS vat_amount,
    get_booking_gross_total(pb.id) AS gross_total
   FROM (private_bookings pb
     LEFT JOIN customers c ON ((pb.customer_id = c.id)));

CREATE OR REPLACE VIEW public.private_booking_summary WITH(security_invoker=true) AS  SELECT pb.id,
    pb.customer_id,
    pb.customer_name,
    pb.contact_phone,
    pb.contact_email,
    pb.event_date,
    pb.start_time,
    pb.setup_time,
    pb.end_time,
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
    c.first_name,
    c.last_name,
    COALESCE(( SELECT sum(private_booking_items.line_total) AS sum
           FROM private_booking_items
          WHERE (private_booking_items.booking_id = pb.id)), (0)::numeric) AS calculated_total,
        CASE
            WHEN (pb.deposit_paid_date IS NOT NULL) THEN 'Paid'::text
            WHEN (pb.status = 'confirmed'::text) THEN 'Required'::text
            ELSE 'Not Required'::text
        END AS deposit_status,
    (pb.event_date - CURRENT_DATE) AS days_until_event
   FROM (private_bookings pb
     LEFT JOIN customers c ON ((pb.customer_id = c.id)));
DROP FUNCTION public.after_booking_credit_settlement();
DROP FUNCTION public.guard_booking_credit_settlement();
DROP FUNCTION public.record_private_booking_allocated_payment(uuid,uuid,date,numeric,text,text,text,jsonb,uuid);
DROP FUNCTION public.cancel_private_booking_charge_batch(uuid,uuid,text,uuid);
DROP FUNCTION public.issue_private_booking_charge_batch(uuid,uuid,integer,uuid);
DROP FUNCTION public.discard_private_booking_charge_batch(uuid,uuid,integer);
DROP FUNCTION public.save_private_booking_charge_batch(uuid,uuid,integer,jsonb,date,text,uuid);
DROP FUNCTION public.invoice_effective_amount(uuid);
DROP FUNCTION public.get_private_booking_aggregate_gross_total(uuid);
DROP FUNCTION public.sync_private_booking_invoice_association();
DROP FUNCTION public.reserve_private_booking_receipt_version(uuid);
ALTER TABLE public.invoice_payments DROP COLUMN receipt_id;
ALTER TABLE public.private_bookings DROP COLUMN receipt_version;
DROP TABLE public.private_booking_payment_receipts;
DROP TABLE public.private_booking_charge_batches;
DROP TABLE public.private_booking_invoices;
CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
 RETURNS TABLE(total_outstanding numeric, total_overdue numeric, total_draft numeric, total_this_month numeric, count_outstanding integer, count_overdue integer, count_draft integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off')
        THEN i.total_amount - i.paid_amount 
      ELSE 0 
    END), 0) AS total_outstanding,
    COALESCE(SUM(CASE 
      WHEN i.status = 'overdue' 
        THEN i.total_amount - i.paid_amount 
      ELSE 0 
    END), 0) AS total_overdue,
    COALESCE(SUM(CASE 
      WHEN i.status = 'draft' 
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_draft,
    COALESCE(SUM(CASE 
      WHEN i.status = 'paid' 
        AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_this_month,
    COUNT(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off') 
        THEN 1 
    END)::INTEGER AS count_outstanding,
    COUNT(CASE 
      WHEN i.status = 'overdue' 
        THEN 1 
    END)::INTEGER AS count_overdue,
    COUNT(CASE 
      WHEN i.status = 'draft' 
        THEN 1 
    END)::INTEGER AS count_draft
  FROM invoices i
  WHERE i.deleted_at IS NULL;
END;
$function$
;
RESET lock_timeout;
