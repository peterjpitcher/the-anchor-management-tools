-- Make Golden Barrels' recorded payments match the money that reached the bank.
--
-- The bank shows GBP 4,355.00 received from Golden Barrels. The app recorded
-- GBP 5,355.00. Two GBP 500 payments were recorded with no money behind them:
--   - INV-003VM, a row reconstructed on 18 August 2026 from the invoice having
--     been marked paid. Only one GBP 500 arrived in February (6 Feb), and it was
--     already counted against INV-003VL.
--   - INV-003VW, recorded by hand on 31 May 2026. Nothing arrived in May.
-- So the app showed GBP 1,000 owed when GBP 2,000 is.
--
-- Owner decision, 9 October 2026: the bank feed is the only record, so the
-- ledger is rebuilt from it, applying each receipt to the oldest unpaid invoice.
-- Every recorded payment then matches a bank line by date and amount:
--
--   28 Nov 2025  455.00 + 400.00  INV-003VB   (unchanged)
--   02 Jan 2026  500.00           INV-003VI   (unchanged)
--   06 Feb 2026  500.00           INV-003VM
--   23 Mar 2026  500.00           INV-003VL
--   13 Apr 2026  250.00           INV-003VP
--   22 Apr 2026  250.00           INV-003VP
--   25 Jun 2026  500.00           INV-003VS
--   21 Aug 2026  1,000.00         INV-003VW and INV-003VZ, 500.00 each
--
-- INV-003WC and INV-003W9 become unpaid, joining INV-003WG and INV-003WW.
--
-- No invoice total changes, no money moves, nothing is emailed. The block
-- refuses to run unless the ledger is exactly as it was when this was written,
-- and refuses to finish unless the result adds up to the bank figure.

DO $$
DECLARE
  v_vendor_id uuid;
  v_old_ids uuid[];
  v_count int;
  v_sum numeric;
  v_note constant text := 'Matched to the bank receipt of this date. Ledger corrected 9 October 2026 to agree with the bank.';
BEGIN
  SELECT id INTO v_vendor_id FROM public.invoice_vendors WHERE name = 'Golden Barrels Limited';
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Golden Barrels Limited not found';
  END IF;

  -- Fail closed if anything has been recorded or changed since this was written.
  SELECT count(*), coalesce(sum(p.amount), 0)
    INTO v_count, v_sum
    FROM public.invoice_payments p
    JOIN public.invoices i ON i.id = p.invoice_id
   WHERE i.vendor_id = v_vendor_id;
  IF v_count <> 12 OR v_sum <> 5355.00 THEN
    RAISE EXCEPTION 'Ledger has changed (% payments, GBP %); expected 12 payments, GBP 5355.00', v_count, v_sum;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_payments p
      JOIN public.invoices i ON i.id = p.invoice_id
     WHERE i.vendor_id = v_vendor_id
       AND (p.receipt_id IS NOT NULL OR p.source_kind IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'A Golden Barrels payment is linked to a receipt or a card capture; not a hand-recorded row';
  END IF;

  -- The rows being replaced: every payment on the eight invoices after INV-003VI.
  SELECT array_agg(p.id)
    INTO v_old_ids
    FROM public.invoice_payments p
    JOIN public.invoices i ON i.id = p.invoice_id
   WHERE i.vendor_id = v_vendor_id
     AND i.invoice_number IN ('INV-003VM', 'INV-003VL', 'INV-003VP', 'INV-003VS',
                              'INV-003VW', 'INV-003VZ', 'INV-003WC', 'INV-003W9');
  IF coalesce(array_length(v_old_ids, 1), 0) <> 9 THEN
    RAISE EXCEPTION 'Expected 9 payments to replace, found %', coalesce(array_length(v_old_ids, 1), 0);
  END IF;

  -- New rows go in before the old ones come out, so an invoice that stays paid
  -- never drops to unpaid part-way through and its work is never re-stamped.
  INSERT INTO public.invoice_payments (invoice_id, payment_date, amount, payment_method, notes)
  SELECT i.id, b.payment_date, b.amount, 'bank_transfer', v_note
    FROM (VALUES
      ('INV-003VM', DATE '2026-02-06', 500.00),
      ('INV-003VL', DATE '2026-03-23', 500.00),
      ('INV-003VP', DATE '2026-04-13', 250.00),
      ('INV-003VP', DATE '2026-04-22', 250.00),
      ('INV-003VS', DATE '2026-06-25', 500.00),
      ('INV-003VW', DATE '2026-08-21', 500.00),
      ('INV-003VZ', DATE '2026-08-21', 500.00)
    ) AS b(invoice_number, payment_date, amount)
    JOIN public.invoices i
      ON i.invoice_number = b.invoice_number
     AND i.vendor_id = v_vendor_id
     AND i.deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'Expected to record 7 payments, recorded %', v_count;
  END IF;

  -- Five of these payments had a "Paid in Full" receipt emailed against them.
  -- The email was really sent, so the log row stays (recipient, subject, date);
  -- only its link to the payment being removed is cleared, to free the foreign
  -- key. Nothing is re-sent and no invoice_payments trigger fires off this.
  UPDATE public.invoice_email_logs SET payment_id = NULL WHERE payment_id = ANY (v_old_ids);

  DELETE FROM public.invoice_payments WHERE id = ANY (v_old_ids);

  -- The payment triggers have now set INV-003WC and INV-003W9 back to unpaid.
  -- Nothing moves their work back from 'paid', so that is done here.
  UPDATE public.oj_entries e
     SET status = 'billed', paid_at = NULL, updated_at = now()
    FROM public.invoices i
   WHERE i.id = e.invoice_id
     AND i.vendor_id = v_vendor_id
     AND i.invoice_number IN ('INV-003WC', 'INV-003W9')
     AND e.status = 'paid';

  UPDATE public.oj_recurring_charge_instances r
     SET status = 'billed', paid_at = NULL, updated_at = now()
    FROM public.invoices i
   WHERE i.id = r.invoice_id
     AND i.vendor_id = v_vendor_id
     AND i.invoice_number IN ('INV-003WC', 'INV-003W9')
     AND r.status = 'paid';

  -- The stage 2 line added earlier today carried the old, unsupported paid date.
  UPDATE public.oj_entries e
     SET paid_at = TIMESTAMPTZ '2026-02-06 00:00:00+00', updated_at = now()
    FROM public.invoices i
   WHERE i.id = e.invoice_id
     AND i.invoice_number = 'INV-003VM'
     AND e.entry_type = 'one_off';

  -- Refuse to finish unless the result is exactly the bank's picture.
  SELECT count(*), coalesce(sum(p.amount), 0)
    INTO v_count, v_sum
    FROM public.invoice_payments p
    JOIN public.invoices i ON i.id = p.invoice_id
   WHERE i.vendor_id = v_vendor_id;
  IF v_count <> 10 OR v_sum <> 4355.00 THEN
    RAISE EXCEPTION 'Result is % payments, GBP %; expected 10 payments, GBP 4355.00', v_count, v_sum;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.vendor_id = v_vendor_id
       AND i.deleted_at IS NULL
       AND i.status <> 'void'
       AND (
         (i.invoice_number IN ('INV-003WC', 'INV-003W9', 'INV-003WG', 'INV-003WW')
            AND (i.status <> 'overdue' OR i.paid_amount <> 0))
         OR
         (i.invoice_number NOT IN ('INV-003WC', 'INV-003W9', 'INV-003WG', 'INV-003WW')
            AND (i.status <> 'paid' OR i.paid_amount <> i.total_amount))
       )
  ) THEN
    RAISE EXCEPTION 'An invoice did not end in the expected state';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.invoices i
      JOIN public.oj_entries e ON e.invoice_id = i.id
     WHERE i.vendor_id = v_vendor_id
       AND i.status <> 'void'
       AND ((i.status = 'paid') <> (e.status = 'paid'))
  ) OR EXISTS (
    SELECT 1
      FROM public.invoices i
      JOIN public.oj_recurring_charge_instances r ON r.invoice_id = i.id
     WHERE i.vendor_id = v_vendor_id
       AND i.status <> 'void'
       AND ((i.status = 'paid') <> (r.status = 'paid'))
  ) THEN
    RAISE EXCEPTION 'Work and its invoice disagree about being paid';
  END IF;
END $$;
