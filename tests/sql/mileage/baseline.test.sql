-- Proves the harness behaves like production before any new migration: the live functions price
-- 4 April 2026 at 55p, and deleting OJ Projects mileage leaves its trip behind.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_home uuid;
  v_shop uuid;
  v_trip uuid;
  v_amount numeric;
  v_vendor uuid;
  v_project uuid;
  v_entry uuid;
BEGIN
  INSERT INTO public.mileage_destinations (name, postcode, is_home_base)
  VALUES ('The Anchor', 'TW19 6AQ', true) RETURNING id INTO v_home;
  INSERT INTO public.mileage_destinations (name, postcode)
  VALUES ('Harness shop', 'TW15 1AA') RETURNING id INTO v_shop;

  v_trip := public.create_manual_mileage_trip_v01(
    DATE '2026-04-04', 'Supplies', 3.4, NULL,
    jsonb_build_array(
      jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 1.7),
      jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 1.7)
    )
  );
  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE id = v_trip;
  ASSERT v_amount = 1.87, format('baseline: the live functions price 4 April 2026 at 55p (1.87), got %s', v_amount);

  INSERT INTO public.invoice_vendors (name) VALUES ('Harness client') RETURNING id INTO v_vendor;
  INSERT INTO public.oj_projects (vendor_id, project_name) VALUES (v_vendor, 'Harness project') RETURNING id INTO v_project;
  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-01', 40, 'Workshop') RETURNING id INTO v_entry;
  ASSERT EXISTS (SELECT 1 FROM public.mileage_trips WHERE oj_entry_id = v_entry), 'baseline: OJ mileage syncs a trip';

  DELETE FROM public.oj_entries WHERE id = v_entry;
  ASSERT EXISTS (
    SELECT 1 FROM public.mileage_trips
    WHERE source = 'oj_projects' AND oj_entry_id IS NULL AND description = 'Workshop'
  ), 'baseline: deleting OJ mileage leaves an orphan trip (the foreign key trigger fires before the sync trigger)';
END $$;

ROLLBACK;

\echo 'MILEAGE BASELINE TESTS PASSED'
