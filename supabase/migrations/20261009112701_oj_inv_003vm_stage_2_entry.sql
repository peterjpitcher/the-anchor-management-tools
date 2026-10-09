-- Record the work behind INV-003VM, so the Golden Barrels Work Record can be
-- produced again.
--
-- INV-003VM is "Dukes Head website, stage 2": a fixed-price GBP 500 invoice dated
-- 5 January 2026, raised before itemised billing existed. Nothing was ever logged
-- against it, and the Work Record refuses to print while any invoice on the
-- account has no work behind it.
--
-- Owner decision, 9 October 2026: the work was done and the invoice stands, so it
-- gets one line. The line states only what the invoice already says: its date,
-- its reference, its amount and its 0% VAT. No hours, dates or task descriptions
-- are invented, because none were recorded at the time.
--
-- Nothing here changes a figure the client has seen. No invoice total moves, no
-- payment is recorded and no credit note is issued.
--
-- Safe to run twice: it does nothing once the invoice has an entry.

DO $$
DECLARE
  v_invoice_id uuid;
  v_vendor_id uuid;
  v_project_id uuid;
BEGIN
  SELECT i.id, i.vendor_id
    INTO v_invoice_id, v_vendor_id
    FROM public.invoices i
   WHERE i.invoice_number = 'INV-003VM'
     AND i.deleted_at IS NULL;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'INV-003VM not found';
  END IF;

  SELECT p.id
    INTO v_project_id
    FROM public.oj_projects p
   WHERE p.project_code = 'OJP-GB-N0KNU'
     AND p.vendor_id = v_vendor_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Website Build project OJP-GB-N0KNU not found for the invoice''s client';
  END IF;

  INSERT INTO public.oj_entries (
    vendor_id, project_id, entry_type, entry_date, description, internal_notes,
    billable, status, invoice_id, billed_at, paid_at,
    amount_ex_vat_snapshot, vat_rate_snapshot
  )
  SELECT
    v_vendor_id, v_project_id, 'one_off', DATE '2026-01-05',
    'The Dukes Head website, stage 2 (fixed price)',
    'Added 9 October 2026. Stage 2 was invoiced before itemised billing, so no time was logged. One line mirroring the invoice, on the owner''s instruction.',
    true, 'paid', v_invoice_id,
    TIMESTAMPTZ '2026-01-05 00:00:00+00', TIMESTAMPTZ '2026-02-04 00:00:00+00',
    500.00, 0
  WHERE NOT EXISTS (
    SELECT 1 FROM public.oj_entries e WHERE e.invoice_id = v_invoice_id
  );
END $$;
