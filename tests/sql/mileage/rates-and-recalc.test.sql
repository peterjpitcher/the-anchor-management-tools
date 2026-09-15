-- Release 1: rate schedule parity, whole-number recalculation, the recalculation trigger, the OJ
-- Projects cascade and grants.
\set ON_ERROR_STOP on

SELECT set_config('mileage.amap_cases', :'amap_cases', false);

-- Parity with tests/fixtures/mileage/amap-rate-cases.json: rates.
DO $$
DECLARE
  v_cases jsonb := current_setting('mileage.amap_cases')::jsonb;
  v_case jsonb;
  v_rates record;
BEGIN
  FOR v_case IN SELECT value FROM jsonb_array_elements(v_cases -> 'rates') LOOP
    SELECT * INTO v_rates FROM public.mileage_amap_rates_v01((v_case ->> 'tripDate')::date);
    IF v_case -> 'standardPence' = 'null'::jsonb THEN
      ASSERT NOT FOUND, format('no rate expected on %s', v_case ->> 'tripDate');
    ELSE
      ASSERT FOUND, format('a rate is expected on %s', v_case ->> 'tripDate');
      ASSERT v_rates.standard_pence = (v_case ->> 'standardPence')::int, format('standard pence on %s', v_case ->> 'tripDate');
      ASSERT v_rates.reduced_pence = (v_case ->> 'reducedPence')::int, format('reduced pence on %s', v_case ->> 'tripDate');
      ASSERT v_rates.threshold_miles = (v_case ->> 'thresholdMiles')::int, format('threshold on %s', v_case ->> 'tripDate');
    END IF;
  END LOOP;
END $$;

-- Parity with the fixture: splits and amounts, priced by the trigger.
DO $$
DECLARE
  v_cases jsonb := current_setting('mileage.amap_cases')::jsonb;
  v_case jsonb;
  v_trip_id uuid;
  v_trip record;
  v_before numeric;
BEGIN
  FOR v_case IN SELECT value FROM jsonb_array_elements(v_cases -> 'splits') LOOP
    DELETE FROM public.mileage_trips;
    v_before := (v_case ->> 'tenthsBefore')::int / 10.0;
    IF v_before > 0 THEN
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
      VALUES (public.mileage_tax_year_start_v01((v_case ->> 'tripDate')::date), 'filler', v_before, v_before, 0, 0, 'manual');
    END IF;
    INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
    VALUES ((v_case ->> 'tripDate')::date, v_case ->> 'name', (v_case ->> 'tripTenths')::int / 10.0, (v_case ->> 'tripTenths')::int / 10.0, 0, 0, 'manual')
    RETURNING id INTO v_trip_id;

    SELECT * INTO v_trip FROM public.mileage_trips WHERE id = v_trip_id;
    ASSERT ROUND(v_trip.miles_at_standard_rate * 10)::int = (v_case ->> 'standardTenths')::int,
      format('%s: standard miles %s', v_case ->> 'name', v_trip.miles_at_standard_rate);
    ASSERT ROUND(v_trip.miles_at_reduced_rate * 10)::int = (v_case ->> 'reducedTenths')::int,
      format('%s: reduced miles %s', v_case ->> 'name', v_trip.miles_at_reduced_rate);
    ASSERT ROUND(v_trip.amount_due * 100)::int = (v_case ->> 'amountPence')::int,
      format('%s: amount %s', v_case ->> 'name', v_trip.amount_due);
  END LOOP;
  DELETE FROM public.mileage_trips;
END $$;

-- Trigger: a crossing trip, a move between tax years and a delete all reprice in the same transaction.
DO $$
DECLARE
  v_big uuid;
  v_small uuid;
  v_amount numeric;
BEGIN
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2025-06-01', 'big', 9999.0, 9999.0, 0, 0, 'manual') RETURNING id INTO v_big;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2025-07-01', 'small', 2.0, 2.0, 0, 0, 'manual') RETURNING id INTO v_small;

  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE id = v_small;
  ASSERT v_amount = 0.70, format('1.0 mi at 45p plus 1.0 mi at 25p is 0.70, got %s', v_amount);

  UPDATE public.mileage_trips SET trip_date = DATE '2026-06-01' WHERE id = v_big;
  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE id = v_small;
  ASSERT v_amount = 0.90, format('with the big trip moved out, 2.0 mi at 45p is 0.90, got %s', v_amount);
  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE id = v_big;
  ASSERT v_amount = 5499.45, format('the moved trip is 9,999.0 mi at 55p, 5,499.45, got %s', v_amount);

  UPDATE public.mileage_trips SET trip_date = DATE '2025-06-01' WHERE id = v_big;
  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE id = v_small;
  ASSERT v_amount = 0.70, format('moved back, 0.70 again, got %s', v_amount);

  DELETE FROM public.mileage_trips WHERE id = v_big;
  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE id = v_small;
  ASSERT v_amount = 0.90, format('after the delete, 0.90, got %s', v_amount);
  DELETE FROM public.mileage_trips;
END $$;

-- Untouched trips are not rewritten, so their updated_at stays put (needed for stale-edit checks).
CREATE TEMP TABLE harness_ids (label text PRIMARY KEY, id uuid, updated_at timestamptz);
INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
VALUES (DATE '2026-05-01', 'first', 10.0, 10.0, 0, 0, 'manual');
INSERT INTO harness_ids SELECT 'first', id, updated_at FROM public.mileage_trips WHERE description = 'first';
SELECT pg_sleep(0.01);
INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
VALUES (DATE '2026-05-02', 'second', 5.0, 5.0, 0, 0, 'manual');
DO $$
BEGIN
  ASSERT (SELECT t.updated_at FROM public.mileage_trips t JOIN harness_ids h ON h.id = t.id WHERE h.label = 'first')
       = (SELECT updated_at FROM harness_ids WHERE label = 'first'),
    'adding a later trip must not rewrite an earlier trip whose figures did not change';
END $$;
DELETE FROM public.mileage_trips;

-- OJ Projects: sync prices at the schedule, a date move reprices, and a delete removes the trip.
DO $$
DECLARE
  v_vendor uuid;
  v_project uuid;
  v_entry uuid;
  v_amount numeric;
BEGIN
  INSERT INTO public.invoice_vendors (name) VALUES ('Harness client') RETURNING id INTO v_vendor;
  INSERT INTO public.oj_projects (vendor_id, project_name) VALUES (v_vendor, 'Harness project') RETURNING id INTO v_project;
  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-04-05', 40, 'Workshop') RETURNING id INTO v_entry;

  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE oj_entry_id = v_entry;
  ASSERT v_amount = 18.00, format('OJ trip on 5 April 2026: 40 mi at 45p is 18.00, got %s', v_amount);

  UPDATE public.oj_entries SET entry_date = DATE '2026-04-06' WHERE id = v_entry;
  SELECT amount_due INTO v_amount FROM public.mileage_trips WHERE oj_entry_id = v_entry;
  ASSERT v_amount = 22.00, format('moved to 6 April 2026: 40 mi at 55p is 22.00, got %s', v_amount);

  DELETE FROM public.oj_entries WHERE id = v_entry;
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips WHERE source = 'oj_projects'),
    'deleting OJ Projects mileage deletes its trip';
END $$;

-- The migration refuses to run over orphaned OJ Projects trips: checked by the runner applying it
-- to an empty harness (none exist); the guard's SQL is exercised here directly.
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips WHERE source = 'oj_projects' AND oj_entry_id IS NULL),
    'no orphaned OJ Projects trips remain in the harness';
END $$;

-- Grants and security settings.
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.mileage_amap_rates_v01(date)', 'EXECUTE'), 'anon must not run mileage_amap_rates_v01';
  ASSERT NOT has_function_privilege('authenticated', 'public.mileage_amap_rates_v01(date)', 'EXECUTE'), 'authenticated must not run mileage_amap_rates_v01';
  ASSERT NOT has_function_privilege('anon', 'public.mileage_tax_year_start_v01(date)', 'EXECUTE'), 'anon must not run mileage_tax_year_start_v01';
  ASSERT NOT has_function_privilege('authenticated', 'public.recalculate_mileage_tax_year_v01(date)', 'EXECUTE'), 'authenticated must not run the recalculation';
  ASSERT NOT has_function_privilege('anon', 'public.fn_mileage_trips_recalculate_v01()', 'EXECUTE'), 'anon must not run the trigger function';
  ASSERT has_function_privilege('service_role', 'public.recalculate_mileage_tax_year_v01(date)', 'EXECUTE'), 'the service role runs the recalculation';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.recalculate_mileage_tax_year_v01(date)'::regprocedure), 'the recalculation stays SECURITY DEFINER';
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = 'public.recalculate_mileage_tax_year_v01(date)'::regprocedure) = ARRAY['search_path=public'],
    'the recalculation keeps search_path=public';
  ASSERT (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'mileage_trips_oj_entry_id_fkey') LIKE '%ON DELETE CASCADE',
    'the OJ Projects foreign key cascades';
END $$;

\echo 'MILEAGE RATES AND RECALC TESTS PASSED'
