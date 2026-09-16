-- Release 4: the report dataset contract, tax year positions and grants.
-- Works before and after the Release 3 cutover makes mileage_trips.driver_id NOT NULL.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_a uuid;
  v_b uuid;
  v_home uuid;
  v_shop uuid;
  v_vendor uuid;
  v_project uuid;
  v_entry uuid;
  v_dataset jsonb;
  v_trip jsonb;
BEGIN
  DELETE FROM public.mileage_trips;
  DELETE FROM public.mileage_vehicles;
  UPDATE public.mileage_drivers SET drives_oj_projects = false;
  DELETE FROM public.mileage_drivers;

  INSERT INTO public.mileage_drivers (display_name, drives_oj_projects) VALUES ('Driver A', true) RETURNING id INTO v_a;
  INSERT INTO public.mileage_drivers (display_name) VALUES ('Driver B') RETURNING id INTO v_b;
  INSERT INTO public.mileage_vehicles (driver_id, valid_from, fuel_type, engine_cc) VALUES (v_a, DATE '2023-01-01', 'petrol', 1598);
  INSERT INTO public.mileage_destinations (name, postcode, is_home_base) VALUES ('Home base', 'ZZ1 1AA', true)
    ON CONFLICT DO NOTHING;
  -- An earlier test may have left a home base; give it a known postcode inside this transaction.
  UPDATE public.mileage_destinations SET postcode = 'ZZ1 1AA' WHERE is_home_base RETURNING id INTO v_home;
  -- A blank postcode must come back as null, not an empty string.
  INSERT INTO public.mileage_destinations (name, postcode) VALUES ('Report shop', '  ') RETURNING id INTO v_shop;

  -- Before the report dates but inside tax year 2025/26: counts towards the position only.
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-03-01', 'Earlier', 100.0, 100.0, 0, 0, 'manual', v_a, 'owner_statement');

  PERFORM public.create_manual_mileage_trip_v02(DATE '2026-04-04', 'Supplies', 3.4, NULL,
    jsonb_build_array(
      jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 1.7),
      jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 1.7)),
    v_a, gen_random_uuid());

  INSERT INTO public.invoice_vendors (name) VALUES ('Client Ltd') RETURNING id INTO v_vendor;
  INSERT INTO public.oj_projects (vendor_id, project_name) VALUES (v_vendor, 'Vision workshop') RETURNING id INTO v_project;
  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-01', 40, 'Workshop') RETURNING id INTO v_entry;

  -- After the report dates: in neither the trips nor the 2026/27 position.
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-07-01', 'Later', 5.0, 5.0, 0, 0, 'manual', v_a, 'entered');

  v_dataset := public.mileage_report_dataset_v01(DATE '2026-04-01', DATE '2026-06-30');

  ASSERT v_dataset ->> 'from' = '2026-04-01' AND v_dataset ->> 'to' = '2026-06-30', 'the dates are echoed as YYYY-MM-DD';
  ASSERT v_dataset ? 'generated_at', 'the generation time is included';
  ASSERT jsonb_array_length(v_dataset -> 'trips') = 2, format('two trips in Q2 2026, got %s', jsonb_array_length(v_dataset -> 'trips'));

  v_trip := v_dataset -> 'trips' -> 0;
  ASSERT v_trip ->> 'trip_date' = '2026-04-04', 'trips come in date order';
  ASSERT (v_trip ->> 'total_miles_tenths')::int = 34, 'miles are whole tenths';
  ASSERT (v_trip ->> 'standard_miles_tenths')::int = 34 AND (v_trip ->> 'reduced_miles_tenths')::int = 0, 'the band split is whole tenths';
  ASSERT (v_trip ->> 'amount_pence')::int = 153, '3.4 mi on 4 April 2026 is 153p';
  ASSERT v_trip ->> 'driver_id' = v_a::text, 'the driver id is included';
  ASSERT v_trip ->> 'driver_name' = 'Driver A', 'the driver name is included';
  ASSERT v_trip ->> 'driver_basis' = 'entered', 'the driver basis is included';
  ASSERT v_trip ->> 'description' = 'Supplies', 'the reason is included';
  ASSERT jsonb_array_length(v_trip -> 'legs') = 2, 'both legs are included';
  ASSERT (v_trip -> 'legs' -> 0 ->> 'leg_order')::int = 1 AND (v_trip -> 'legs' -> 1 ->> 'leg_order')::int = 2, 'legs come in order';
  ASSERT (v_trip -> 'legs' -> 0 ->> 'from_is_home_base')::boolean, 'the first leg starts at the home base';
  ASSERT v_trip -> 'legs' -> 0 ->> 'from_postcode' = 'ZZ1 1AA', 'a recorded postcode is included';
  ASSERT v_trip -> 'legs' -> 0 -> 'to_postcode' = 'null'::jsonb, 'a blank postcode is null, not an empty string';
  ASSERT (v_trip -> 'legs' -> 0 ->> 'miles_tenths')::int = 17, 'leg miles are whole tenths';

  v_trip := v_dataset -> 'trips' -> 1;
  ASSERT v_trip ->> 'source' = 'oj_projects', 'the OJ Projects trip is included';
  ASSERT (v_trip ->> 'amount_pence')::int = 2200, '40 mi on 1 May 2026 is 2,200p';
  ASSERT v_trip ->> 'driver_basis' = 'oj_projects', 'the OJ Projects trip has the OJ Projects basis';
  ASSERT jsonb_array_length(v_trip -> 'legs') = 0, 'OJ Projects trips have no legs';
  ASSERT v_trip ->> 'oj_project_name' = 'Vision workshop', 'the OJ project name is included';
  ASSERT v_trip ->> 'oj_client_name' = 'Client Ltd', 'the OJ client name is included';
  ASSERT NOT (v_trip ? 'invoice_id') AND NOT (v_trip ? 'status') AND NOT (v_trip ? 'oj_entry_id'), 'no billing state leaks into mileage evidence';

  ASSERT jsonb_array_length(v_dataset -> 'tax_year_positions') = 4, 'two drivers times two tax years';
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_dataset -> 'tax_year_positions') p
    WHERE p ->> 'driver_id' = v_a::text AND p ->> 'tax_year_start' = '2025-04-06'
      AND p ->> 'cutoff_date' = '2026-04-05' AND (p ->> 'miles_tenths_to_cutoff')::int = 1034
  ), 'Driver A in 2025/26 counts the March trip before the report dates: 1000 + 34 tenths';
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_dataset -> 'tax_year_positions') p
    WHERE p ->> 'driver_id' = v_a::text AND p ->> 'tax_year_start' = '2026-04-06'
      AND p ->> 'cutoff_date' = '2026-06-30' AND (p ->> 'miles_tenths_to_cutoff')::int = 400
  ), 'Driver A in 2026/27 is cut off at the report end, leaving out the July trip';
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_dataset -> 'tax_year_positions') p
    WHERE p ->> 'driver_id' = v_b::text AND p ->> 'tax_year_start' = '2025-04-06' AND (p ->> 'miles_tenths_to_cutoff')::int = 0
  ), 'a driver with no trips has a zero position';
  ASSERT (v_dataset -> 'tax_year_positions' -> 0 ->> 'driver_id') = v_a::text
    AND (v_dataset -> 'tax_year_positions' -> 0 ->> 'tax_year_start') = '2025-04-06'
    AND (v_dataset -> 'tax_year_positions' -> 3 ->> 'driver_id') = v_b::text,
    'positions come in driver name then tax year order';

  ASSERT jsonb_array_length(v_dataset -> 'drivers') = 2, 'both drivers are listed';
  ASSERT v_dataset -> 'drivers' -> 0 ->> 'display_name' = 'Driver A', 'drivers come in name order';
  ASSERT jsonb_array_length(v_dataset -> 'vehicles') = 1, 'the car is listed';
  ASSERT v_dataset -> 'vehicles' -> 0 = jsonb_build_object('driver_id', v_a, 'valid_from', '2023-01-01', 'fuel_type', 'petrol', 'engine_cc', 1598),
    'the car carries its driver, start date, fuel and engine size';

  v_dataset := public.mileage_report_dataset_v01(DATE '2026-08-01', DATE '2026-09-30');
  ASSERT jsonb_array_length(v_dataset -> 'trips') = 0, 'an empty period has no trips';
  ASSERT jsonb_array_length(v_dataset -> 'tax_year_positions') = 2, 'an empty period still has a position per driver';
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_dataset -> 'tax_year_positions') p
    WHERE p ->> 'driver_id' = v_a::text AND (p ->> 'miles_tenths_to_cutoff')::int = 450
  ), 'an empty period still counts the tax year to date: 400 + 50 tenths';

  v_dataset := public.mileage_report_dataset_v01(DATE '2026-04-05', DATE '2026-04-06');
  ASSERT jsonb_array_length(v_dataset -> 'tax_year_positions') = 4, 'two days either side of 6 April touch two tax years';
END $$;

ROLLBACK;

-- Before the Release 3 cutover a trip can still have no driver. The dataset must refuse rather
-- than leave that trip out of the claim or the tax year position. After the cutover the column is
-- NOT NULL, so there is nothing to check.
BEGIN;

DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.mileage_trips'::regclass AND attname = 'driver_id') THEN
    RAISE NOTICE 'mileage_trips.driver_id is NOT NULL; the no-driver check is not needed';
    RETURN;
  END IF;

  DELETE FROM public.mileage_trips;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2026-03-01', 'No driver yet', 10.0, 10.0, 0, 0, 'manual');

  ASSERT jsonb_array_length(public.mileage_report_dataset_v01(DATE '2026-04-06', DATE '2026-06-30') -> 'trips') = 0,
    'a trip with no driver in an earlier tax year does not block the report';

  BEGIN
    PERFORM public.mileage_report_dataset_v01(DATE '2026-04-01', DATE '2026-04-30');
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'MILEAGE_REPORT_TRIPS_WITHOUT_DRIVER', format('unexpected error %s', SQLERRM);
    v_raised := true;
  END;
  ASSERT v_raised, 'a trip with no driver earlier in the tax year stops the report';

  ASSERT EXISTS (SELECT 1 FROM public.mileage_trip_rows_v01 WHERE driver_id IS NULL),
    'the trip rows view keeps a trip with no driver instead of hiding it';
END $$;

ROLLBACK;

-- Grants and security settings: nothing for PUBLIC, anon or authenticated; the service role reads.
DO $$
DECLARE
  v_role text;
  v_privilege text;
  v_function constant text := 'public.mileage_report_dataset_v01(date, date)';
  v_view constant text := 'public.mileage_trip_rows_v01';
BEGIN
  ASSERT NOT has_function_privilege('anon', v_function, 'EXECUTE'), 'anon must not run the dataset';
  ASSERT NOT has_function_privilege('authenticated', v_function, 'EXECUTE'), 'authenticated must not run the dataset';
  ASSERT has_function_privilege('service_role', v_function, 'EXECUTE'), 'the service role runs the dataset';
  ASSERT (SELECT proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) FROM pg_proc WHERE oid = v_function::regprocedure),
    'PUBLIC cannot run the dataset';
  ASSERT (SELECT NOT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = v_function::regprocedure),
    'the dataset is STABLE, runs with the caller''s rights and pins search_path=public';

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      ASSERT NOT has_table_privilege(v_role, v_view, v_privilege), format('%s must not %s the trip rows view', v_role, v_privilege);
    END LOOP;
  END LOOP;
  ASSERT has_table_privilege('service_role', v_view, 'SELECT'), 'the service role reads the trip rows view';
  FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    ASSERT NOT has_table_privilege('service_role', v_view, v_privilege), format('the service role must not %s the trip rows view', v_privilege);
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = v_view::regclass AND a.grantee = 0),
    'PUBLIC has no grant on the trip rows view';
  ASSERT (SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = v_view::regclass),
    'the trip rows view runs with the caller''s rights';
END $$;

\echo 'MILEAGE REPORT DATASET TESTS PASSED'
