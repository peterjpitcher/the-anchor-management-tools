-- Back-date the Golden Barrels "Seaandseeds.co.uk" monthly charge to 1 June 2026.
--
-- The charge was added on 9 October 2026. A recurring charge has no start date:
-- the billing run only creates the month it is billing, so on its own this one
-- would first appear for October. Owner instruction, 9 October 2026: it runs
-- from 1 June 2026.
--
-- This adds the four months already gone (June to September 2026) as unbilled
-- rows, at the amount and VAT rate on the charge itself. The 1 November run
-- picks up unbilled rows from earlier periods and adds October itself, so they
-- are billed from then, within the client's monthly cap.
--
-- Nothing is invoiced or emailed by this. Safe to run twice: a month that
-- already has a row is left alone.

DO $$
DECLARE
  v_charge public.oj_vendor_recurring_charges%ROWTYPE;
  v_count int;
BEGIN
  SELECT c.*
    INTO v_charge
    FROM public.oj_vendor_recurring_charges c
    JOIN public.invoice_vendors v ON v.id = c.vendor_id
   WHERE v.name = 'Golden Barrels Limited'
     AND c.description = 'Seaandseeds.co.uk'
     AND c.is_active;

  IF v_charge.id IS NULL THEN
    RAISE EXCEPTION 'Active Seaandseeds.co.uk charge not found for Golden Barrels Limited';
  END IF;
  IF v_charge.frequency <> 'monthly' THEN
    RAISE EXCEPTION 'Seaandseeds.co.uk charge is %, expected monthly', v_charge.frequency;
  END IF;

  INSERT INTO public.oj_recurring_charge_instances (
    vendor_id, recurring_charge_id, period_yyyymm, period_start, period_end,
    coverage_start, coverage_end, description_snapshot, amount_ex_vat_snapshot,
    vat_rate_snapshot, sort_order_snapshot, status
  )
  SELECT
    v_charge.vendor_id, v_charge.id, to_char(m.month_start, 'YYYY-MM'),
    m.month_start::date, (m.month_start + interval '1 month - 1 day')::date,
    m.month_start::date, (m.month_start + interval '1 month - 1 day')::date,
    v_charge.description, v_charge.amount_ex_vat, v_charge.vat_rate,
    v_charge.sort_order, 'unbilled'
  FROM generate_series(TIMESTAMP '2026-06-01', TIMESTAMP '2026-09-01', interval '1 month') AS m(month_start)
  ON CONFLICT (vendor_id, recurring_charge_id, period_yyyymm) DO NOTHING;

  SELECT count(*) INTO v_count
    FROM public.oj_recurring_charge_instances
   WHERE recurring_charge_id = v_charge.id
     AND period_yyyymm IN ('2026-06', '2026-07', '2026-08', '2026-09');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Expected 4 back-dated months, found %', v_count;
  END IF;
END $$;
