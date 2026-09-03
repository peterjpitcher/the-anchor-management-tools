-- Cancel a private booking's invoice so a corrected one can be raised.
--
-- Why this exists
-- ---------------
-- Until now a private booking could be invoiced exactly once, for good. Two
-- separate things made a re-issue impossible:
--
--   1. `create_private_booking_invoice_atomic` short circuits whenever
--      `private_bookings.invoice_id` is set and returns the FIRST invoice, so
--      pressing "Generate and send invoice" again could never produce a
--      corrected document.
--   2. The generic void path in the app counts rows in `invoice_payments` and
--      refuses to void when it finds any. When the operator chose to deduct the
--      deposit, the invoicing RPC itself mirrors that deposit in as a payment
--      row, so the invoice blocks its own void over money that was never paid
--      against it. The deposit lives on the booking (`deposit_amount`), and the
--      mirrored row is presentation, not a receipt.
--
-- So an operator who needed to change the booked items after invoicing had no
-- route at all. This function is that route: it voids the invoice, removes the
-- mirrored deposit, and releases the booking so the normal generate flow can
-- run again against the corrected items.
--
-- What it refuses
-- ---------------
-- A REAL payment (any row that is not the mirrored deposit) blocks the cancel.
-- Money genuinely received against an invoice must be resolved with a credit
-- note, not by making the invoice disappear underneath it.
--
-- Recovering a stuck booking
-- --------------------------
-- An invoice that is already void is not an error here. Voiding from the
-- invoice screen leaves the booking still pointing at the dead invoice with no
-- way forward, and this function unlinks that state rather than refusing it.

CREATE OR REPLACE FUNCTION public.cancel_private_booking_invoice_atomic(
  p_booking_id uuid,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) IS
  'Voids a private booking''s invoice, removes the mirrored deposit payment and unlinks the booking so a corrected invoice can be raised. Refuses when a real payment exists.';

-- Callable only by the service role. Every caller goes through the server
-- action, which enforces super admin. No anon or authenticated grant is issued,
-- and the event trigger strips the implicit PUBLIC EXECUTE grant.
REVOKE ALL ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) TO service_role;
