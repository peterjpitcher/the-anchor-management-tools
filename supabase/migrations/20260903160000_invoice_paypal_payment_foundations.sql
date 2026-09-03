-- Foundations for letting a customer pay an invoice by PayPal.
--
-- Mirrors the private booking deposit flow, which has four independent ways a
-- payment can arrive (staff redirect, customer portal return, webhook, and a
-- 15 minute reconciliation cron). All four must be able to record the same
-- capture without double counting it, so idempotency lives in the database
-- rather than in any one caller.
--
-- The idempotency key is PayPal's capture id, which is globally unique. It is
-- stored in invoice_payments.reference and guarded by a partial unique index,
-- so whichever path arrives first wins and the rest are no-ops.

-- 1. Track the in-flight order on the invoice, so a second request reuses it
--    rather than opening a second PayPal order for the same money, and so the
--    reconciliation cron has something to look up.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS paypal_order_id text,
  ADD COLUMN IF NOT EXISTS paypal_reconciliation_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paypal_reconciliation_last_error text;

COMMENT ON COLUMN public.invoices.paypal_order_id IS
  'In-flight PayPal order for this invoice. Cleared once the invoice is settled or the order goes stale.';

-- Only unsettled invoices are ever polled, so the index carries just those.
CREATE INDEX IF NOT EXISTS idx_invoices_paypal_order_open
  ON public.invoices (paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

-- 2. One row per PayPal capture, whichever path records it first.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_paypal_capture_key
  ON public.invoice_payments (reference)
  WHERE source_kind = 'paypal';

-- 3. The single writer. Every capture path calls this and nothing else.
CREATE OR REPLACE FUNCTION public.record_invoice_paypal_payment_atomic(
  p_invoice_id uuid,
  p_amount numeric,
  p_capture_id text,
  p_order_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text) IS
  'Records a PayPal capture against an invoice exactly once, keyed on the capture id, and recalculates paid_amount and status from the payment rows.';

-- service_role only. `authenticated` picks EXECUTE up through ALTER DEFAULT
-- PRIVILEGES and holds it in its own right, so it has to be named explicitly:
-- a REVOKE FROM PUBLIC does not remove it.
REVOKE ALL ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid, numeric, text, text) TO service_role;
