-- Release 3 part B: the driver cutover. The runner runs this file once per phase (psql variable
-- phase), around the cutover migration:
--
--   no_driver       production before the backfill: trips with no driver, so the migration refuses
--   no_oj_driver    backfilled, but OJ Projects trips and no OJ Projects driver: it refuses
--   amounts_change  a tax year where counting per driver changes stored amounts: it refuses
--   backfilled      production after the backfill: the migration applies
--   after           nothing moved, not-null drivers, per-driver limits, OJ Projects without a
--                   driver, old app builds refused, v02 saves, headline totals, grants
--
-- Every phase after the first starts by proving the step before it (a refused migration, or the
-- cutover itself) added, removed or changed no trip.
\set ON_ERROR_STOP on

SELECT :'phase' = 'no_driver' AS phase_no_driver,
       :'phase' = 'no_oj_driver' AS phase_no_oj_driver,
       :'phase' = 'amounts_change' AS phase_amounts_change,
       :'phase' = 'backfilled' AS phase_backfilled,
       :'phase' = 'after' AS phase_after,
       :'phase' IN ('no_oj_driver', 'amounts_change', 'backfilled') AS phase_after_refusal
\gset

\if :phase_no_driver
CREATE SCHEMA mileage_cutover_harness;
CREATE TABLE mileage_cutover_harness.trips_before AS
SELECT id, driver_id, driver_basis, miles_at_standard_rate, miles_at_reduced_rate, amount_due, updated_at
FROM public.mileage_trips WITH NO DATA;
\else
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM mileage_cutover_harness.trips_before) > 0, 'the comparison covers the seeded trips';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.mileage_trips t
    FULL JOIN mileage_cutover_harness.trips_before b ON b.id = t.id
    WHERE t.id IS NULL
       OR b.id IS NULL
       OR (t.driver_id, t.driver_basis, t.miles_at_standard_rate, t.miles_at_reduced_rate, t.amount_due, t.updated_at)
          IS DISTINCT FROM (b.driver_id, b.driver_basis, b.miles_at_standard_rate, b.miles_at_reduced_rate, b.amount_due, b.updated_at)
  ), 'the migration step since the last phase added, removed or changed a trip (driver, figures or updated_at)';
END $$;
\endif

\if :phase_after_refusal
-- A refused migration leaves nothing of itself behind.
DO $$
BEGIN
  ASSERT NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.mileage_trips'::regclass AND attname = 'driver_id'),
    'after a refusal, driver_id is still nullable';
  ASSERT NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.mileage_trips'::regclass AND attname = 'driver_basis'),
    'after a refusal, driver_basis is still nullable';
  ASSERT to_regprocedure('public.recalculate_mileage_driver_tax_year_v01(uuid, date)') IS NULL, 'after a refusal, no per-driver recalculation exists';
  ASSERT to_regprocedure('public.fn_mileage_trips_recalculate_v02()') IS NULL, 'after a refusal, no v02 trigger function exists';
  ASSERT to_regprocedure('public.mileage_headline_totals_v01(date)') IS NULL, 'after a refusal, no headline totals function exists';
  ASSERT (SELECT tgfoid FROM pg_trigger WHERE tgname = 'trg_mileage_trips_recalculate') = 'public.fn_mileage_trips_recalculate_v01()'::regprocedure,
    'after a refusal, the trigger still runs the Release 1 function';
  ASSERT (SELECT prosrc NOT LIKE '%MILEAGE_APP_OUTDATED%' FROM pg_proc WHERE oid = 'public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb)'::regprocedure),
    'after a refusal, the v01 create still saves';
  ASSERT (SELECT prosrc NOT LIKE '%MILEAGE_OJ_DRIVER_MISSING%' FROM pg_proc WHERE oid = 'public.fn_sync_oj_mileage_to_trips()'::regprocedure),
    'after a refusal, the OJ Projects sync is the foundation version';
END $$;
\endif

\if :phase_no_driver
-- Production before the backfill: trips logged before drivers existed have no driver, OJ Projects
-- mileage synced before the OJ Projects driver was set up has none either, and trips saved since
-- migration A have one. The Release 1 trigger priced them all per tax year, every driver together.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
  v_vendor uuid;
  v_project uuid;
  v_early_oj uuid;
  v_late_oj uuid;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips), 'the cutover phases start with no trips';
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  ASSERT v_one IS NOT NULL AND v_two IS NOT NULL, 'drivers.test.sql leaves Driver One and Driver Two';
  ASSERT (SELECT drives_oj_projects FROM public.mileage_drivers WHERE id = v_two), 'drivers.test.sql leaves Driver Two driving OJ Projects';

  -- 2023/24: one driver alone goes over 10,000 miles, so 25p applies the same way per driver.
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2023-06-01', 'legacy long haul', 9990.0, 9990.0, 0, 0, 'manual');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2023-07-01', 'legacy over the limit', 20.0, 20.0, 0, 0, 'manual');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2025-05-10', 'legacy supplies', 120.0, 120.0, 0, 0, 'manual');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2026-04-05', 'legacy last day of 45p', 30.0, 30.0, 0, 0, 'manual');

  INSERT INTO public.invoice_vendors (name) VALUES ('Cutover client') RETURNING id INTO v_vendor;
  INSERT INTO public.oj_projects (vendor_id, project_name) VALUES (v_vendor, 'Cutover project') RETURNING id INTO v_project;

  UPDATE public.mileage_drivers SET drives_oj_projects = false WHERE drives_oj_projects;
  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2025-06-01', 42, 'OJ before set-up') RETURNING id INTO v_early_oj;
  UPDATE public.mileage_drivers SET drives_oj_projects = true WHERE id = v_two;

  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-05-01', 'entered, Driver One', 17.3, 17.3, 0, 0, 'manual', v_one, 'entered');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-05-01', 'entered, Driver Two', 4.4, 4.4, 0, 0, 'manual', v_two, 'entered');
  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-02', 25, 'OJ after set-up') RETURNING id INTO v_late_oj;

  ASSERT (SELECT count(*) FROM public.mileage_trips) = 8, 'eight trips are seeded';
  ASSERT (SELECT count(*) FROM public.mileage_trips WHERE driver_id IS NULL) = 5, 'five trips have no driver yet';
  ASSERT (SELECT (miles_at_standard_rate, miles_at_reduced_rate, amount_due) = (10.0, 10.0, 7.00) FROM public.mileage_trips WHERE description = 'legacy over the limit'),
    '2023/24: 10.0 mi at 45p plus 10.0 mi at 25p is 7.00';
  ASSERT (SELECT driver_id IS NULL AND amount_due = 18.90 FROM public.mileage_trips WHERE oj_entry_id = v_early_oj),
    'OJ mileage from before the set-up has no driver: 42 mi at 45p is 18.90';
  ASSERT (SELECT driver_id = v_two AND driver_basis = 'oj_projects' AND amount_due = 13.75 FROM public.mileage_trips WHERE oj_entry_id = v_late_oj),
    'OJ mileage from after the set-up has the OJ Projects driver: 25 mi at 55p is 13.75';
END $$;

\elif :phase_no_oj_driver
-- The backfill gives every trip a driver without repricing anything. Then no driver is marked as
-- driving OJ Projects while OJ Projects trips exist.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
BEGIN
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';

  UPDATE public.mileage_trips SET driver_id = v_one, driver_basis = 'owner_statement' WHERE driver_id IS NULL AND source = 'manual';
  UPDATE public.mileage_trips SET driver_id = v_two, driver_basis = 'oj_projects' WHERE driver_id IS NULL AND source = 'oj_projects';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.mileage_trips t
    JOIN mileage_cutover_harness.trips_before b ON b.id = t.id
    WHERE (t.miles_at_standard_rate, t.miles_at_reduced_rate, t.amount_due)
          IS DISTINCT FROM (b.miles_at_standard_rate, b.miles_at_reduced_rate, b.amount_due)
  ), 'setting drivers reprices nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips WHERE driver_id IS NULL), 'every trip has a driver';

  UPDATE public.mileage_drivers SET drives_oj_projects = false WHERE drives_oj_projects;
  ASSERT (SELECT count(*) FROM public.mileage_trips WHERE source = 'oj_projects') = 2, 'OJ Projects trips exist';
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_drivers WHERE drives_oj_projects), 'no driver drives OJ Projects';
END $$;

\elif :phase_amounts_change
-- 2024/25: two drivers do 6,000 miles each. Counted together (the Release 1 trigger), the second
-- trip crosses 10,000 miles; counted per driver, neither does, so the cutover would change amounts.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
BEGIN
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  UPDATE public.mileage_drivers SET drives_oj_projects = true WHERE id = v_two;

  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2024-05-01', 'crossing, Driver One', 6000.0, 6000.0, 0, 0, 'manual', v_one, 'entered');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2024-06-01', 'crossing, Driver Two', 6000.0, 6000.0, 0, 0, 'manual', v_two, 'entered');

  ASSERT (SELECT (miles_at_standard_rate, miles_at_reduced_rate, amount_due) = (4000.0, 2000.0, 2300.00) FROM public.mileage_trips WHERE description = 'crossing, Driver Two'),
    'counted together: 4,000.0 mi at 45p plus 2,000.0 mi at 25p is 2,300.00 (per driver it would be 2,700.00)';
END $$;

\elif :phase_backfilled
-- Production after the backfill: every trip has a driver, one OJ Projects driver, and nobody near
-- 10,000 miles in a tax year shared with another driver.
DO $$
BEGIN
  DELETE FROM public.mileage_trips WHERE description LIKE 'crossing, %';
  ASSERT (SELECT count(*) FROM public.mileage_trips) = 8, 'the eight seeded trips remain';
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips WHERE driver_id IS NULL), 'every trip has a driver';
  ASSERT (SELECT count(*) FROM public.mileage_drivers WHERE drives_oj_projects AND is_active) = 1, 'exactly one active OJ Projects driver';
  ASSERT (SELECT count(*) FROM public.mileage_trips WHERE source = 'oj_projects') = 2, 'OJ Projects trips exist';
  ASSERT EXISTS (SELECT 1 FROM public.mileage_trips WHERE miles_at_reduced_rate > 0), 'a trip at 25p is part of the no-change check';
END $$;

\elif :phase_after
-- The cutover itself changed nothing (checked above against the backfilled trips); totals agree.
DO $$
BEGIN
  ASSERT (SELECT sum(amount_due) FROM public.mileage_trips) = 4614.59, 'the backfilled trips still total 4,614.59';
  ASSERT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.mileage_trips'::regclass AND attname = 'driver_id'), 'driver_id is not null';
  ASSERT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.mileage_trips'::regclass AND attname = 'driver_basis'), 'driver_basis is not null';
  ASSERT (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_mileage_trips_recalculate')
         LIKE '%AFTER INSERT OR DELETE OR UPDATE OF trip_date, total_miles, driver_id ON public.mileage_trips FOR EACH ROW EXECUTE FUNCTION fn_mileage_trips_recalculate_v02()',
    'the trigger reprices on trip_date, total_miles and driver_id with the v02 function';
  ASSERT (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.mileage_trips'::regclass AND tgfoid = 'public.fn_mileage_trips_recalculate_v01()'::regprocedure) = 0,
    'no trigger runs the Release 1 function any more';
END $$;

DO $$
DECLARE
  v_one uuid;
BEGIN
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';

  BEGIN
    INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
    VALUES (DATE '2026-05-01', 'no driver', 1.0, 1.0, 0, 0, 'manual');
    RAISE EXCEPTION 'expected a not-null violation for a trip with no driver';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id)
    VALUES (DATE '2026-05-01', 'no basis', 1.0, 1.0, 0, 0, 'manual', v_one);
    RAISE EXCEPTION 'expected a not-null violation for a trip with no driver basis';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.mileage_trips SET driver_id = NULL WHERE description = 'legacy supplies';
    RAISE EXCEPTION 'expected a not-null violation when clearing a driver';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END $$;

-- Each driver has their own 10,000 miles. Moving a trip between drivers or tax years, and deleting
-- one, reprices every group it leaves or joins.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
  v_big uuid;
  v_small uuid;
  v_trip record;
BEGIN
  DELETE FROM public.oj_entries;
  DELETE FROM public.mileage_trips;
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';

  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-05-01', 'big', 9999.0, 9999.0, 0, 0, 'manual', v_one, 'entered') RETURNING id INTO v_big;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-05-02', 'small', 2.0, 2.0, 0, 0, 'manual', v_two, 'entered') RETURNING id INTO v_small;

  SELECT * INTO v_trip FROM public.mileage_trips WHERE id = v_small;
  ASSERT v_trip.amount_due = 1.10, format('Driver Two has their own limit: 2.0 mi at 55p is 1.10, got %s', v_trip.amount_due);

  UPDATE public.mileage_trips SET driver_id = v_one WHERE id = v_small;
  SELECT * INTO v_trip FROM public.mileage_trips WHERE id = v_small;
  ASSERT (v_trip.miles_at_standard_rate, v_trip.miles_at_reduced_rate, v_trip.amount_due) = (1.0, 1.0, 0.80),
    format('behind Driver One''s 9,999 miles: 1.0 mi at 55p plus 1.0 mi at 25p is 0.80, got %s', v_trip.amount_due);

  UPDATE public.mileage_trips SET driver_id = v_two WHERE id = v_small;
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_small) = 1.10, 'moved back to Driver Two, 1.10 again';

  UPDATE public.mileage_trips SET driver_id = v_two WHERE id = v_big;
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_small) = 0.80, 'the big trip moving to Driver Two reprices Driver Two''s group';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_big) = 5499.45, 'the big trip is still 9,999.0 mi at 55p';

  UPDATE public.mileage_trips SET trip_date = DATE '2025-05-01' WHERE id = v_big;
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_small) = 1.10, 'the big trip moving tax year reprices the year it left';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_big) = 4499.55, 'and the year it joined: 9,999.0 mi at 45p is 4,499.55';

  UPDATE public.mileage_trips SET trip_date = DATE '2026-05-01' WHERE id = v_big;
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_small) = 0.80, 'moved back into 2026/27, 0.80 again';
  DELETE FROM public.mileage_trips WHERE id = v_big;
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_small) = 1.10, 'deleting the big trip reprices its group';

  DELETE FROM public.mileage_trips;
END $$;

-- The recalculation functions: the tax-year one covers every driver in that year only; the
-- per-driver one covers one driver and takes any date in the tax year.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
BEGIN
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-05-03', 'one, 2026/27', 10.0, 10.0, 0, 0, 'manual', v_one, 'entered');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-05-02', 'two, 2026/27', 2.0, 2.0, 0, 0, 'manual', v_two, 'entered');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2025-05-01', 'one, 2025/26', 4.0, 4.0, 0, 0, 'manual', v_one, 'entered');

  -- Figure columns are not in the trigger's column list, so this leaves every trip mispriced.
  UPDATE public.mileage_trips SET amount_due = 0;

  PERFORM public.recalculate_mileage_tax_year_v01(DATE '2026-06-01');
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE description = 'one, 2026/27') = 5.50, 'the tax-year recalculation reprices Driver One';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE description = 'two, 2026/27') = 1.10, 'the tax-year recalculation reprices Driver Two';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE description = 'one, 2025/26') = 0, 'the tax-year recalculation leaves other tax years alone';

  UPDATE public.mileage_trips SET amount_due = 0;
  PERFORM public.recalculate_mileage_driver_tax_year_v01(v_one, DATE '2027-01-15');
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE description = 'one, 2026/27') = 5.50, 'a date inside the tax year selects the tax year';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE description = 'two, 2026/27') = 0, 'the per-driver recalculation leaves other drivers alone';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE description = 'one, 2025/26') = 0, 'the per-driver recalculation leaves other tax years alone';

  BEGIN
    PERFORM public.recalculate_mileage_driver_tax_year_v01(NULL, DATE '2026-05-01');
    RAISE EXCEPTION 'expected a refusal without a driver';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'Driver and tax year are required', format('expected Driver and tax year are required, got %s', SQLERRM);
  END;

  DELETE FROM public.mileage_trips;
END $$;

-- OJ Projects: with no OJ Projects driver, new OJ Projects mileage fails instead of creating a
-- driverless trip; edits to existing OJ Projects mileage still sync and keep their driver.
DO $$
DECLARE
  v_two uuid;
  v_vendor uuid;
  v_project uuid;
  v_entry uuid;
  v_time uuid;
BEGIN
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  SELECT id INTO v_vendor FROM public.invoice_vendors WHERE name = 'Cutover client';
  SELECT id INTO v_project FROM public.oj_projects WHERE project_name = 'Cutover project';

  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-01', 10, 'With a driver') RETURNING id INTO v_entry;
  ASSERT (SELECT driver_id = v_two AND driver_basis = 'oj_projects' AND amount_due = 5.50 FROM public.mileage_trips WHERE oj_entry_id = v_entry),
    'OJ Projects mileage takes the OJ Projects driver: 10 mi at 55p is 5.50';

  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'time', DATE '2026-05-01', NULL, 'Workshop hours') RETURNING id INTO v_time;

  UPDATE public.mileage_drivers SET drives_oj_projects = false WHERE drives_oj_projects;

  BEGIN
    INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
    VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-01', 10, 'No driver');
    RAISE EXCEPTION 'expected MILEAGE_OJ_DRIVER_MISSING';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_OJ_DRIVER_MISSING', format('expected MILEAGE_OJ_DRIVER_MISSING, got %s', SQLERRM);
  END;

  BEGIN
    UPDATE public.oj_entries SET entry_type = 'mileage', miles = 3 WHERE id = v_time;
    RAISE EXCEPTION 'expected MILEAGE_OJ_DRIVER_MISSING when an entry becomes mileage';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_OJ_DRIVER_MISSING', format('expected MILEAGE_OJ_DRIVER_MISSING when an entry becomes mileage, got %s', SQLERRM);
  END;

  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'time', DATE '2026-05-02', NULL, 'Other work');

  UPDATE public.oj_entries SET miles = 12 WHERE id = v_entry;
  ASSERT (SELECT driver_id = v_two AND total_miles = 12.0 AND amount_due = 6.60 FROM public.mileage_trips WHERE oj_entry_id = v_entry),
    'editing existing OJ Projects mileage still syncs and keeps its driver: 12 mi at 55p is 6.60';
  ASSERT (SELECT count(*) FROM public.mileage_trips) = 1, 'the refused entries created no trip';

  UPDATE public.mileage_drivers SET drives_oj_projects = true WHERE id = v_two;
  DELETE FROM public.oj_entries;
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips), 'deleting OJ Projects mileage still deletes its trip';
END $$;

-- An old app build calling the v01 save functions gets a clear refusal and saves nothing.
DO $$
DECLARE
  v_home uuid;
  v_shop uuid;
  v_legs jsonb;
BEGIN
  SELECT id INTO v_home FROM public.mileage_destinations WHERE is_home_base;
  SELECT id INTO v_shop FROM public.mileage_destinations WHERE name = 'Harness shop';
  v_legs := jsonb_build_array(
    jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 1.7),
    jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 1.7)
  );

  BEGIN
    PERFORM public.create_manual_mileage_trip_v01(DATE '2026-05-01', 'old app', 3.4, NULL, v_legs);
    RAISE EXCEPTION 'expected MILEAGE_APP_OUTDATED from create v01';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_APP_OUTDATED', format('expected MILEAGE_APP_OUTDATED from create v01, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.update_manual_mileage_trip_v01(gen_random_uuid(), DATE '2026-05-01', 'old app', 3.4, v_legs);
    RAISE EXCEPTION 'expected MILEAGE_APP_OUTDATED from update v01';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_APP_OUTDATED', format('expected MILEAGE_APP_OUTDATED from update v01, got %s', SQLERRM);
  END;

  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips), 'the refused old saves created no trip';
END $$;

-- The current app's v02 saves work on the cutover schema, and an edit that changes the driver
-- prices the trip in the new driver's group.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
  v_home uuid;
  v_shop uuid;
  v_legs jsonb;
  v_result jsonb;
  v_trip record;
BEGIN
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  SELECT id INTO v_home FROM public.mileage_destinations WHERE is_home_base;
  SELECT id INTO v_shop FROM public.mileage_destinations WHERE name = 'Harness shop';
  v_legs := jsonb_build_array(
    jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 1.7),
    jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 1.7)
  );

  v_result := public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 3.4, NULL, v_legs, v_one, gen_random_uuid());
  ASSERT (v_result ->> 'created')::boolean, 'v02 create saves after the cutover';
  SELECT * INTO v_trip FROM public.mileage_trips WHERE id = (v_result ->> 'id')::uuid;
  ASSERT (v_trip.driver_id, v_trip.driver_basis, v_trip.amount_due) = (v_one, 'entered', 1.87), 'the v02 trip has its driver and 3.4 mi at 55p is 1.87';

  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-04-10', 'Driver Two long haul', 9999.0, 9999.0, 0, 0, 'manual', v_two, 'entered');

  PERFORM public.update_manual_mileage_trip_v02(v_trip.id, v_trip.trip_date, 'Supplies', 3.4, v_legs, v_two, v_trip.updated_at);
  SELECT * INTO v_trip FROM public.mileage_trips WHERE id = v_trip.id;
  ASSERT (v_trip.driver_id, v_trip.miles_at_standard_rate, v_trip.miles_at_reduced_rate, v_trip.amount_due) = (v_two, 1.0, 2.4, 1.15),
    format('behind Driver Two''s 9,999 miles: 1.0 mi at 55p plus 2.4 mi at 25p is 1.15, got %s', v_trip.amount_due);

  DELETE FROM public.mileage_trips;
END $$;

-- Headline totals: quarter, financial year (January to December), tax year, and miles left at the
-- standard rate for each active driver.
DO $$
DECLARE
  v_one uuid;
  v_two uuid;
  v_retired uuid;
  v_stats jsonb;
BEGIN
  SELECT id INTO v_one FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_two FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  INSERT INTO public.mileage_drivers (display_name, is_active) VALUES ('Driver Retired', false) RETURNING id INTO v_retired;

  v_stats := public.mileage_headline_totals_v01(DATE '2026-05-15');
  ASSERT v_stats -> 'quarter' = '{"from": "2026-04-01", "to": "2026-06-30", "trips": 0, "miles_tenths": 0, "amount_pence": 0}'::jsonb,
    format('with no trips the quarter is all zeros, got %s', v_stats -> 'quarter');
  ASSERT jsonb_array_length(v_stats -> 'drivers') = 2, 'with no trips both active drivers are still listed';

  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-02-01', 'February', 5.0, 5.0, 0, 0, 'manual', v_one, 'entered'),
         (DATE '2026-03-31', 'end of March', 1.0, 1.0, 0, 0, 'manual', v_two, 'entered'),
         (DATE '2026-04-06', 'retired driver', 1.0, 1.0, 0, 0, 'manual', v_retired, 'owner_statement'),
         (DATE '2026-05-01', 'May', 10.0, 10.0, 0, 0, 'manual', v_one, 'entered'),
         (DATE '2026-06-30', 'end of June', 2.0, 2.0, 0, 0, 'manual', v_two, 'entered'),
         (DATE '2026-07-01', 'July', 3.0, 3.0, 0, 0, 'manual', v_two, 'entered'),
         (DATE '2027-01-02', 'next January', 4.0, 4.0, 0, 0, 'manual', v_one, 'entered');

  v_stats := public.mileage_headline_totals_v01(DATE '2026-05-15');
  ASSERT v_stats -> 'quarter' = '{"from": "2026-04-01", "to": "2026-06-30", "trips": 3, "miles_tenths": 130, "amount_pence": 715}'::jsonb,
    format('quarter: retired 1.0, May 10.0 and end of June 2.0 at 55p, got %s', v_stats -> 'quarter');
  ASSERT v_stats -> 'financial_year' = '{"from": "2026-01-01", "to": "2026-12-31", "trips": 6, "miles_tenths": 220, "amount_pence": 1150}'::jsonb,
    format('financial year: February 5.0 and March 1.0 at 45p (270p), plus the quarter (715p) and July 3.0 at 55p (165p), got %s', v_stats -> 'financial_year');
  ASSERT v_stats -> 'tax_year' = '{"from": "2026-04-06", "to": "2027-04-05", "trips": 5, "miles_tenths": 200, "amount_pence": 1100}'::jsonb,
    format('tax year 2026/27: the quarter, July and next January 4.0 at 55p (220p), got %s', v_stats -> 'tax_year');
  ASSERT v_stats -> 'drivers' = jsonb_build_array(
    jsonb_build_object('driver_id', v_one, 'display_name', 'Driver One', 'tax_year_miles_tenths', 140, 'standard_miles_left_tenths', 99860),
    jsonb_build_object('driver_id', v_two, 'display_name', 'Driver Two', 'tax_year_miles_tenths', 50, 'standard_miles_left_tenths', 99950)
  ), format('active drivers only, by name, with their own tax-year miles, got %s', v_stats -> 'drivers');

  DELETE FROM public.mileage_trips;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2025-05-01', 'over the limit', 10000.5, 10000.5, 0, 0, 'manual', v_two, 'entered');
  v_stats := public.mileage_headline_totals_v01(DATE '2025-06-01');
  ASSERT v_stats -> 'drivers' = jsonb_build_array(
    jsonb_build_object('driver_id', v_one, 'display_name', 'Driver One', 'tax_year_miles_tenths', 0, 'standard_miles_left_tenths', 100000),
    jsonb_build_object('driver_id', v_two, 'display_name', 'Driver Two', 'tax_year_miles_tenths', 100005, 'standard_miles_left_tenths', 0)
  ), format('miles left never go below zero, got %s', v_stats -> 'drivers');
  ASSERT (v_stats -> 'tax_year' ->> 'amount_pence')::int = 450013, '10,000.0 mi at 45p plus 0.5 mi at 25p (12.5p, rounded up) is 4,500.13';

  DELETE FROM public.mileage_trips;
  DELETE FROM public.mileage_drivers WHERE id = v_retired;
END $$;

-- Grants and security settings: nothing for PUBLIC, anon or authenticated; the service role runs
-- everything; the live SECURITY DEFINER and search_path settings are kept.
DO $$
DECLARE
  v_function text;
  v_role text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.recalculate_mileage_driver_tax_year_v01(uuid, date)',
    'public.recalculate_mileage_tax_year_v01(date)',
    'public.fn_mileage_trips_recalculate_v02()',
    'public.fn_sync_oj_mileage_to_trips()',
    'public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb)',
    'public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb)',
    'public.mileage_headline_totals_v01(date)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', v_function, 'EXECUTE'), format('anon must not run %s', v_function);
    ASSERT NOT has_function_privilege('authenticated', v_function, 'EXECUTE'), format('authenticated must not run %s', v_function);
    ASSERT has_function_privilege('service_role', v_function, 'EXECUTE'), format('the service role runs %s', v_function);
    ASSERT (SELECT proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) FROM pg_proc WHERE oid = v_function::regprocedure),
      format('PUBLIC cannot run %s', v_function);
    ASSERT (SELECT proconfig FROM pg_proc WHERE oid = v_function::regprocedure) = ARRAY['search_path=public'],
      format('%s pins search_path=public', v_function);
    ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = v_function::regprocedure) = (v_function <> 'public.mileage_headline_totals_v01(date)'),
      format('%s keeps its security setting (definer, except the headline totals)', v_function);
  END LOOP;

  ASSERT (SELECT pg_get_function_result('public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb)'::regprocedure)) = 'uuid',
    'create v01 keeps its uuid result';
  ASSERT (SELECT pg_get_function_result('public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb)'::regprocedure)) = 'jsonb',
    'update v01 keeps its jsonb result';

  -- Calling as the roles themselves, not only reading the catalogue.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM public.mileage_headline_totals_v01(DATE '2026-05-15');
      RAISE EXCEPTION '% ran the headline totals', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM public.recalculate_mileage_driver_tax_year_v01(gen_random_uuid(), DATE '2026-05-15');
      RAISE EXCEPTION '% ran the per-driver recalculation', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM public.recalculate_mileage_tax_year_v01(DATE '2026-05-15');
      RAISE EXCEPTION '% ran the tax-year recalculation', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  ASSERT current_user = 'postgres', 'the role checks leave the session as it was';
END $$;

\else
DO $$ BEGIN RAISE EXCEPTION 'unknown driver cutover phase'; END $$;
\endif

\if :phase_after
DROP SCHEMA mileage_cutover_harness CASCADE;
\else
TRUNCATE mileage_cutover_harness.trips_before;
INSERT INTO mileage_cutover_harness.trips_before
SELECT id, driver_id, driver_basis, miles_at_standard_rate, miles_at_reduced_rate, amount_due, updated_at
FROM public.mileage_trips;
\endif

SELECT format('MILEAGE DRIVER CUTOVER TESTS PASSED (%s)', :'phase') AS passed_marker
\gset
\echo :passed_marker
