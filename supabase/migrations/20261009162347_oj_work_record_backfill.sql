-- Tie the invoices raised before time tracking to the work behind them, so the
-- Work Record can be produced for every client and every invoice on it has
-- something to show.
--
-- Time tracking was added in January 2026 and earlier work was entered
-- afterwards, marked as paid but never linked to the invoice that charged it.
-- Owner instruction, 9 October 2026: backfill the links so everything ties up.
--
-- Nothing here changes an invoice total, a payment or anything a client has been
-- sent. No row is deleted.
--
-- 1. Barons Pubs, three invoices raised by hand. The time logged for each period
--    matches the hours on the invoice exactly, which is the evidence for the link:
--      INV-003V4  "September 2025"  31.50 h invoiced, 31.50 h logged (23 entries)
--      INV-003VA  "October 2025"    37.00 h invoiced, 37.00 h logged (13 entries)
--      INV-003VG  "Nov/Dec 2025"    36.50 h invoiced, 36.50 h logged (19 entries)
--    Mileage for those months was logged but is on none of the three invoices,
--    so it is deliberately left alone here.
--
-- 2. Barons Pubs, INV-003V1 (19 July 2025, training, 6 hours, GBP 375.00). It
--    pre-dates every logged entry, so it gets one line mirroring the invoice,
--    as INV-003VM did. There was no project for it, so one is created.
--
-- 3. Golden Barrels, INV-003VB (the vision workshop). Invoiced as a quoted 9.5
--    hours; 7.5 hours and mileage were logged. Owner confirmed it was a fixed
--    price, so it is marked as one.
--
-- 4. Golden Barrels, INV-003WC. A reissue on 17 August 2026 moved work off this
--    invoice and kept its GBP 500 total, leaving GBP 157.92 ex VAT invoiced with
--    nothing behind it while a 16 hour entry stayed wholly unbilled. 2.5 hours
--    of that entry (GBP 156.25) is split off onto the invoice, the same way the
--    billing run splits an entry. The entry keeps the other 13.5 hours.
--
-- Every step checks the rows are as they were when this was written and stops,
-- changing nothing, if they are not. Safe to run twice.

DO $$
DECLARE
  v_barons uuid;
  v_golden uuid;
  v_invoice uuid;
  v_project uuid;
  v_parent public.oj_entries%ROWTYPE;
  v_count int;
  v_minutes bigint;
  r record;
BEGIN
  SELECT id INTO v_barons FROM public.invoice_vendors WHERE name = 'Barons Pubs';
  SELECT id INTO v_golden FROM public.invoice_vendors WHERE name = 'Golden Barrels Limited';
  IF v_barons IS NULL OR v_golden IS NULL THEN
    RAISE EXCEPTION 'Barons Pubs or Golden Barrels Limited not found';
  END IF;

  -- 1. Barons Pubs: link logged time to the invoice for its period.
  FOR r IN
    SELECT * FROM (VALUES
      ('INV-003V4', DATE '2025-09-01', DATE '2025-09-30', 23, 1890),
      ('INV-003VA', DATE '2025-10-01', DATE '2025-10-31', 13, 2220),
      ('INV-003VG', DATE '2025-11-01', DATE '2025-12-31', 19, 2190)
    ) AS t(invoice_number, period_from, period_to, expected_entries, expected_minutes)
  LOOP
    SELECT id INTO v_invoice
      FROM public.invoices
     WHERE invoice_number = r.invoice_number AND vendor_id = v_barons AND deleted_at IS NULL;
    IF v_invoice IS NULL THEN
      RAISE EXCEPTION '% not found for Barons Pubs', r.invoice_number;
    END IF;

    -- Already linked on an earlier run: nothing to do for this invoice.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.oj_entries WHERE invoice_id = v_invoice);

    SELECT count(*), coalesce(sum(duration_minutes_rounded), 0)
      INTO v_count, v_minutes
      FROM public.oj_entries
     WHERE vendor_id = v_barons
       AND invoice_id IS NULL
       AND status = 'paid'
       AND billable
       AND entry_type = 'time'
       AND entry_date BETWEEN r.period_from AND r.period_to;
    IF v_count <> r.expected_entries OR v_minutes <> r.expected_minutes THEN
      RAISE EXCEPTION '%: found % entries and % minutes, expected % and %',
        r.invoice_number, v_count, v_minutes, r.expected_entries, r.expected_minutes;
    END IF;

    UPDATE public.oj_entries
       SET invoice_id = v_invoice, updated_at = now()
     WHERE vendor_id = v_barons
       AND invoice_id IS NULL
       AND status = 'paid'
       AND billable
       AND entry_type = 'time'
       AND entry_date BETWEEN r.period_from AND r.period_to;
  END LOOP;

  -- 2. Barons Pubs: INV-003V1, invoiced before any time was logged.
  SELECT id INTO v_invoice
    FROM public.invoices
   WHERE invoice_number = 'INV-003V1' AND vendor_id = v_barons AND deleted_at IS NULL;
  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'INV-003V1 not found for Barons Pubs';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.oj_entries WHERE invoice_id = v_invoice) THEN
    INSERT INTO public.oj_projects (vendor_id, project_code, project_name, status, internal_notes)
    VALUES (
      v_barons, 'OJP-BP-TRN25', 'Training (July 2025)', 'completed',
      'Created 9 October 2026 to hold INV-003V1, which was invoiced before time tracking existed.'
    )
    ON CONFLICT (project_code) DO NOTHING;

    SELECT id INTO v_project FROM public.oj_projects WHERE project_code = 'OJP-BP-TRN25' AND vendor_id = v_barons;
    IF v_project IS NULL THEN
      RAISE EXCEPTION 'Project OJP-BP-TRN25 could not be created for Barons Pubs';
    END IF;

    INSERT INTO public.oj_entries (
      vendor_id, project_id, entry_type, entry_date, description, internal_notes,
      billable, status, invoice_id, billed_at, paid_at,
      amount_ex_vat_snapshot, vat_rate_snapshot
    )
    VALUES (
      v_barons, v_project, 'one_off', DATE '2025-07-19',
      'Training and education services, 6 hours',
      'Added 9 October 2026. Invoiced before time tracking, so no time was logged. One line mirroring the invoice.',
      true, 'paid', v_invoice,
      TIMESTAMPTZ '2025-07-19 00:00:00+00', TIMESTAMPTZ '2025-09-05 00:00:00+00',
      375.00, 20
    );
  END IF;

  -- 3. Golden Barrels: the vision workshop was a fixed price.
  UPDATE public.invoices
     SET is_fixed_price = true, updated_at = now()
   WHERE invoice_number = 'INV-003VB'
     AND vendor_id = v_golden
     AND is_fixed_price = false;

  -- 4. Golden Barrels: put 2.5 hours of the unbilled build onto INV-003WC.
  SELECT id INTO v_invoice
    FROM public.invoices
   WHERE invoice_number = 'INV-003WC' AND vendor_id = v_golden AND deleted_at IS NULL;
  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'INV-003WC not found for Golden Barrels Limited';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.oj_entries WHERE invoice_id = v_invoice AND split_from_entry_id IS NOT NULL
  ) THEN
    SELECT * INTO v_parent
      FROM public.oj_entries
     WHERE vendor_id = v_golden
       AND entry_date = DATE '2026-05-31'
       AND entry_type = 'time'
       AND status = 'unbilled'
       AND invoice_id IS NULL
       AND duration_minutes_rounded = 960
       FOR UPDATE;
    IF v_parent.id IS NULL THEN
      RAISE EXCEPTION 'The unbilled 16 hour entry of 31 May 2026 is not as expected';
    END IF;

    UPDATE public.oj_entries
       SET duration_minutes_rounded = 810, duration_minutes_raw = 810, updated_at = now()
     WHERE id = v_parent.id;

    INSERT INTO public.oj_entries (
      vendor_id, project_id, entry_type, entry_date, duration_minutes_raw, duration_minutes_rounded,
      work_type_id, work_type_name_snapshot, description, internal_notes, billable, status,
      invoice_id, billed_at, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot,
      split_from_entry_id
    )
    VALUES (
      v_parent.vendor_id, v_parent.project_id, 'time', v_parent.entry_date, 150, 150,
      v_parent.work_type_id, v_parent.work_type_name_snapshot, v_parent.description,
      'Split off 9 October 2026 onto INV-003WC, which had been invoiced on account for it since the reissue of 17 August 2026.',
      true, 'billed', v_invoice, TIMESTAMPTZ '2026-07-01 00:00:00+00',
      v_parent.hourly_rate_ex_vat_snapshot, v_parent.vat_rate_snapshot, v_parent.mileage_rate_snapshot,
      v_parent.id
    );
  END IF;

  -- Refuse to finish unless every invoice named above now has work behind it
  -- and no logged time for Barons Pubs is left without an invoice.
  IF EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.invoice_number IN ('INV-003V1', 'INV-003V4', 'INV-003VA', 'INV-003VG')
       AND NOT EXISTS (SELECT 1 FROM public.oj_entries e WHERE e.invoice_id = i.id)
  ) THEN
    RAISE EXCEPTION 'A Barons Pubs invoice still has no work linked to it';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.oj_entries
     WHERE vendor_id = v_barons AND invoice_id IS NULL AND status <> 'unbilled'
       AND billable AND entry_type = 'time'
  ) THEN
    RAISE EXCEPTION 'Barons Pubs still has settled time with no invoice';
  END IF;

  -- The split must not have created or lost any time.
  SELECT coalesce(sum(e.duration_minutes_rounded), 0) INTO v_minutes
    FROM public.oj_entries e
   WHERE e.vendor_id = v_golden
     AND e.entry_date = DATE '2026-05-31'
     AND e.entry_type = 'time'
     AND e.duration_minutes_rounded IN (810, 150);
  IF v_minutes <> 960 THEN
    RAISE EXCEPTION 'The 31 May build no longer adds up to 16 hours (% minutes)', v_minutes;
  END IF;
END $$;
