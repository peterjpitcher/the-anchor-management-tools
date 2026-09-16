-- Release 3 part A: driver and car tables, v02 saves, preview ordering, OJ Projects driver, grants.
\set ON_ERROR_STOP on

-- Constraints on drivers and cars.
DO $$
DECLARE
  v_first uuid;
BEGIN
  INSERT INTO public.mileage_drivers (display_name, drives_oj_projects) VALUES ('Driver One', true) RETURNING id INTO v_first;

  BEGIN
    INSERT INTO public.mileage_drivers (display_name, drives_oj_projects) VALUES ('Driver Two', true);
    RAISE EXCEPTION 'expected a unique violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.mileage_drivers (display_name) VALUES ('driver one ');
    RAISE EXCEPTION 'expected a unique violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.mileage_drivers (display_name) VALUES ('   ');
    RAISE EXCEPTION 'expected a check violation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.mileage_drivers SET is_active = false WHERE id = v_first;
    RAISE EXCEPTION 'expected a check violation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.mileage_vehicles (driver_id, valid_from, fuel_type) VALUES (v_first, DATE '2024-01-01', 'petrol');
    RAISE EXCEPTION 'expected a check violation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.mileage_vehicles (driver_id, valid_from, fuel_type, engine_cc) VALUES (v_first, DATE '2024-01-01', 'hybrid', 1600);
    RAISE EXCEPTION 'expected a check violation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.mileage_vehicles (driver_id, valid_from, fuel_type) VALUES (v_first, DATE '2024-01-01', 'electric_home');
  BEGIN
    INSERT INTO public.mileage_vehicles (driver_id, valid_from, fuel_type, engine_cc) VALUES (v_first, DATE '2024-01-01', 'diesel', 1600);
    RAISE EXCEPTION 'expected a unique violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM public.mileage_drivers WHERE id = v_first;
    RAISE EXCEPTION 'expected a foreign key violation';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM public.mileage_vehicles;
  DELETE FROM public.mileage_drivers;
END $$;

-- v02 create: validation, driver basis, and a retry with the same request id.
DO $$
DECLARE
  v_driver uuid;
  v_retired uuid;
  v_home uuid;
  v_shop uuid;
  v_legs jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_request uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.mileage_drivers (display_name) VALUES ('Driver One') RETURNING id INTO v_driver;
  INSERT INTO public.mileage_drivers (display_name, is_active) VALUES ('Driver Retired', false) RETURNING id INTO v_retired;
  INSERT INTO public.mileage_destinations (name, is_home_base) VALUES ('The Anchor', true) RETURNING id INTO v_home;
  INSERT INTO public.mileage_destinations (name) VALUES ('Harness shop') RETURNING id INTO v_shop;
  v_legs := jsonb_build_array(
    jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 1.7),
    jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 1.7)
  );

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 3.4, NULL, v_legs, v_driver, NULL);
    RAISE EXCEPTION 'expected MILEAGE_REQUEST_ID_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_REQUEST_ID_REQUIRED', format('expected MILEAGE_REQUEST_ID_REQUIRED, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(NULL, 'Supplies', 3.4, NULL, v_legs, v_driver, gen_random_uuid());
    RAISE EXCEPTION 'expected MILEAGE_TRIP_DATE_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_TRIP_DATE_REQUIRED', format('expected MILEAGE_TRIP_DATE_REQUIRED, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 3.4, NULL, v_legs, NULL, gen_random_uuid());
    RAISE EXCEPTION 'expected MILEAGE_DRIVER_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_DRIVER_REQUIRED', format('expected MILEAGE_DRIVER_REQUIRED, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 3.4, NULL, v_legs, v_retired, gen_random_uuid());
    RAISE EXCEPTION 'expected MILEAGE_DRIVER_REQUIRED for an inactive driver';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_DRIVER_REQUIRED', format('expected MILEAGE_DRIVER_REQUIRED for an inactive driver, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(DATE '2026-05-01', '   ', 3.4, NULL, v_legs, v_driver, gen_random_uuid());
    RAISE EXCEPTION 'expected MILEAGE_REASON_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_REASON_REQUIRED', format('expected MILEAGE_REASON_REQUIRED, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 0, NULL, v_legs, v_driver, gen_random_uuid());
    RAISE EXCEPTION 'expected MILEAGE_MILES_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_MILES_REQUIRED', format('expected MILEAGE_MILES_REQUIRED, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.create_manual_mileage_trip_v02(((now() AT TIME ZONE 'Europe/London')::date + 1), 'Supplies', 3.4, NULL, v_legs, v_driver, gen_random_uuid());
    RAISE EXCEPTION 'expected MILEAGE_TRIP_DATE_IN_FUTURE';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_TRIP_DATE_IN_FUTURE', format('expected MILEAGE_TRIP_DATE_IN_FUTURE, got %s', SQLERRM);
  END;

  ASSERT (SELECT count(*) FROM public.mileage_trips) = 0, 'refused saves leave no trip behind';

  v_result := public.create_manual_mileage_trip_v02(DATE '2026-05-01', ' Supplies ', 3.4, NULL, v_legs, v_driver, v_request);
  ASSERT (v_result ->> 'created')::boolean, 'the first save creates the trip';
  v_retry := public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 3.4, NULL, v_legs, v_driver, v_request);
  ASSERT NOT (v_retry ->> 'created')::boolean, 'a retry with the same request id does not create another trip';
  ASSERT v_retry ->> 'id' = v_result ->> 'id', 'the retry returns the original trip';
  ASSERT (SELECT count(*) FROM public.mileage_trips) = 1, 'exactly one trip exists';
  ASSERT (SELECT count(*) FROM public.mileage_trip_legs) = 2, 'the retry does not add legs';
  ASSERT (SELECT driver_id FROM public.mileage_trips) = v_driver, 'the trip records the driver';
  ASSERT (SELECT driver_basis FROM public.mileage_trips) = 'entered', 'a trip saved in the form records basis entered';
  ASSERT (SELECT create_request_id FROM public.mileage_trips) = v_request, 'the trip records the request id';
  ASSERT (SELECT description FROM public.mileage_trips) = 'Supplies', 'the reason is trimmed';
  ASSERT (SELECT amount_due FROM public.mileage_trips) = 1.87, 'the trigger prices the new trip at 55p';

  BEGIN
    UPDATE public.mileage_trips SET driver_basis = NULL;
    RAISE EXCEPTION 'expected a check violation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  DELETE FROM public.mileage_drivers WHERE id = v_retired;
END $$;

-- v02 update: stale edits are refused and a fresh edit records the driver.
DO $$
DECLARE
  v_trip record;
  v_other uuid;
  v_legs jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO v_trip FROM public.mileage_trips LIMIT 1;
  INSERT INTO public.mileage_drivers (display_name) VALUES ('Driver Two') RETURNING id INTO v_other;
  SELECT jsonb_agg(jsonb_build_object('from_destination_id', from_destination_id, 'to_destination_id', to_destination_id, 'miles', miles) ORDER BY leg_order)
    INTO v_legs FROM public.mileage_trip_legs WHERE trip_id = v_trip.id;

  BEGIN
    PERFORM public.update_manual_mileage_trip_v02(gen_random_uuid(), v_trip.trip_date, 'Supplies', 3.4, v_legs, v_other, v_trip.updated_at);
    RAISE EXCEPTION 'expected MILEAGE_TRIP_NOT_FOUND';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_TRIP_NOT_FOUND', format('expected MILEAGE_TRIP_NOT_FOUND, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.update_manual_mileage_trip_v02(v_trip.id, v_trip.trip_date, 'Supplies', 3.4, v_legs, v_other, v_trip.updated_at - INTERVAL '1 second');
    RAISE EXCEPTION 'expected MILEAGE_TRIP_CONFLICT';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_TRIP_CONFLICT', format('expected MILEAGE_TRIP_CONFLICT, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.update_manual_mileage_trip_v02(v_trip.id, v_trip.trip_date, 'Supplies', 3.4, v_legs, v_other, NULL);
    RAISE EXCEPTION 'expected MILEAGE_TRIP_CONFLICT without an expected timestamp';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_TRIP_CONFLICT', format('expected MILEAGE_TRIP_CONFLICT without an expected timestamp, got %s', SQLERRM);
  END;

  BEGIN
    PERFORM public.update_manual_mileage_trip_v02(v_trip.id, v_trip.trip_date, 'Supplies', 3.4, v_legs, NULL, v_trip.updated_at);
    RAISE EXCEPTION 'expected MILEAGE_DRIVER_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_DRIVER_REQUIRED', format('expected MILEAGE_DRIVER_REQUIRED, got %s', SQLERRM);
  END;

  ASSERT (SELECT driver_id FROM public.mileage_trips WHERE id = v_trip.id) = v_trip.driver_id, 'refused edits leave the driver alone';

  v_result := public.update_manual_mileage_trip_v02(v_trip.id, v_trip.trip_date, 'Supplies run', 3.4, v_legs, v_other, v_trip.updated_at);
  ASSERT v_result ->> 'id' = v_trip.id::text, 'the edit returns the trip id';
  ASSERT (v_result ->> 'old_trip_date')::date = v_trip.trip_date, 'the edit returns the old date';
  ASSERT (v_result ->> 'old_total_miles')::numeric = v_trip.total_miles, 'the edit returns the old miles';
  ASSERT (SELECT driver_id FROM public.mileage_trips WHERE id = v_trip.id) = v_other, 'the edit changes the driver';
  ASSERT (SELECT driver_basis FROM public.mileage_trips WHERE id = v_trip.id) = 'entered', 'the edit records basis entered';
  ASSERT (SELECT description FROM public.mileage_trips WHERE id = v_trip.id) = 'Supplies run', 'the edit changes the reason';
  ASSERT (SELECT count(*) FROM public.mileage_trip_legs WHERE trip_id = v_trip.id) = 2, 'legs are replaced, not duplicated';
  ASSERT (SELECT array_agg(leg_order ORDER BY leg_order) FROM public.mileage_trip_legs WHERE trip_id = v_trip.id) = ARRAY[1, 2]::smallint[],
    'replaced legs are renumbered from 1';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE id = v_trip.id) = 1.87, 'the edited trip is still priced at 55p';
END $$;

-- Preview: miles before the trip's position within the driver's tax year. Creation times are set
-- explicitly: now() is fixed for a whole transaction, so two inserts here would otherwise tie.
DO $$
DECLARE
  v_driver uuid;
  v_other uuid;
  v_early uuid;
  v_late uuid;
BEGIN
  DELETE FROM public.mileage_trips;
  SELECT id INTO v_driver FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_other FROM public.mileage_drivers WHERE display_name = 'Driver Two';
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis, created_at)
  VALUES (DATE '2026-05-01', 'early', 10.0, 10.0, 0, 0, 'manual', v_driver, 'entered', TIMESTAMPTZ '2026-05-01 09:00:00+01') RETURNING id INTO v_early;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis, created_at)
  VALUES (DATE '2026-05-01', 'late', 5.0, 5.0, 0, 0, 'manual', v_driver, 'entered', TIMESTAMPTZ '2026-05-01 10:00:00+01') RETURNING id INTO v_late;
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-04-20', 'another driver', 7.0, 7.0, 0, 0, 'manual', v_other, 'entered');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source)
  VALUES (DATE '2026-04-21', 'no driver yet', 3.0, 3.0, 0, 0, 'manual');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-04-10', 'same driver, earlier', 2.5, 2.5, 0, 0, 'manual', v_driver, 'entered');
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-04-01', 'same driver, previous tax year', 1.5, 1.5, 0, 0, 'manual', v_driver, 'entered');

  ASSERT public.mileage_rate_preview_v01(v_driver, DATE '2026-05-01', NULL) = 17.5, 'a new trip counts after every trip on the same day, in this tax year only';
  ASSERT public.mileage_rate_preview_v01(v_driver, DATE '2026-05-01', v_late) = 12.5, 'an existing trip counts only trips created before it';
  ASSERT public.mileage_rate_preview_v01(v_driver, DATE '2026-05-01', v_early) = 2.5, 'the first trip that day counts only earlier days';
  ASSERT public.mileage_rate_preview_v01(v_driver, DATE '2026-04-30', NULL) = 2.5, 'later days do not count';
  ASSERT public.mileage_rate_preview_v01(v_driver, DATE '2026-04-05', NULL) = 1.5, 'the previous tax year counts only its own trips';
  ASSERT public.mileage_rate_preview_v01(v_driver, DATE '2025-04-06', NULL) = 0.0, 'the first day of a tax year with no trips before it is zero';
  ASSERT public.mileage_rate_preview_v01(v_other, DATE '2026-05-01', NULL) = 7.0, 'each driver counts only their own trips';
  DELETE FROM public.mileage_trips;
END $$;

-- OJ Projects: new mileage takes the OJ Projects driver; updates never reassign it; deletes remove it.
DO $$
DECLARE
  v_oj_driver uuid;
  v_other uuid;
  v_vendor uuid;
  v_project uuid;
  v_entry uuid;
  v_unassigned uuid;
  v_trip uuid;
BEGIN
  SELECT id INTO v_oj_driver FROM public.mileage_drivers WHERE display_name = 'Driver One';
  SELECT id INTO v_other FROM public.mileage_drivers WHERE display_name = 'Driver Two';

  INSERT INTO public.invoice_vendors (name) VALUES ('Harness client') RETURNING id INTO v_vendor;
  INSERT INTO public.oj_projects (vendor_id, project_name) VALUES (v_vendor, 'Harness project') RETURNING id INTO v_project;

  -- Until the setup script and the cutover, OJ mileage with no OJ Projects driver still saves, with no driver.
  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-01', 10, 'Before set-up') RETURNING id INTO v_unassigned;
  ASSERT (SELECT driver_id IS NULL AND driver_basis IS NULL FROM public.mileage_trips WHERE oj_entry_id = v_unassigned),
    'with no OJ Projects driver, the synced trip has no driver yet';
  DELETE FROM public.oj_entries WHERE id = v_unassigned;

  UPDATE public.mileage_drivers SET drives_oj_projects = true WHERE id = v_oj_driver;

  INSERT INTO public.oj_entries (vendor_id, project_id, entry_type, entry_date, miles, description)
  VALUES (v_vendor, v_project, 'mileage', DATE '2026-05-01', 40, 'Workshop') RETURNING id INTO v_entry;

  ASSERT (SELECT driver_id FROM public.mileage_trips WHERE oj_entry_id = v_entry) = v_oj_driver, 'OJ mileage takes the OJ Projects driver';
  ASSERT (SELECT driver_basis FROM public.mileage_trips WHERE oj_entry_id = v_entry) = 'oj_projects', 'OJ mileage records basis oj_projects';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE oj_entry_id = v_entry) = 22.00, '40 mi at 55p is 22.00';

  SELECT id INTO v_trip FROM public.mileage_trips WHERE oj_entry_id = v_entry;
  BEGIN
    PERFORM public.update_manual_mileage_trip_v02(v_trip, DATE '2026-05-01', 'Workshop', 40, '[]'::jsonb, v_other,
      (SELECT updated_at FROM public.mileage_trips WHERE id = v_trip));
    RAISE EXCEPTION 'expected MILEAGE_OJ_TRIP_READ_ONLY';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'MILEAGE_OJ_TRIP_READ_ONLY', format('expected MILEAGE_OJ_TRIP_READ_ONLY, got %s', SQLERRM);
  END;

  UPDATE public.mileage_drivers SET drives_oj_projects = false WHERE id = v_oj_driver;
  UPDATE public.mileage_drivers SET drives_oj_projects = true WHERE id = v_other;
  UPDATE public.oj_entries SET miles = 42 WHERE id = v_entry;
  ASSERT (SELECT driver_id FROM public.mileage_trips WHERE oj_entry_id = v_entry) = v_oj_driver, 'resyncing never reassigns the driver';
  ASSERT (SELECT driver_basis FROM public.mileage_trips WHERE oj_entry_id = v_entry) = 'oj_projects', 'resyncing keeps the basis';
  ASSERT (SELECT total_miles FROM public.mileage_trips WHERE oj_entry_id = v_entry) = 42.0, 'the resync updates the miles';
  ASSERT (SELECT amount_due FROM public.mileage_trips WHERE oj_entry_id = v_entry) = 23.10, '42 mi at 55p is 23.10 after the resync';

  UPDATE public.oj_entries SET entry_type = 'time' WHERE id = v_entry;
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips WHERE oj_entry_id = v_entry), 'changing the entry away from mileage removes its trip';
  UPDATE public.oj_entries SET entry_type = 'mileage' WHERE id = v_entry;
  ASSERT (SELECT driver_id FROM public.mileage_trips WHERE oj_entry_id = v_entry) = v_other, 'changing the entry back to mileage takes the current OJ Projects driver';

  DELETE FROM public.oj_entries WHERE id = v_entry;
  ASSERT NOT EXISTS (SELECT 1 FROM public.mileage_trips WHERE source = 'oj_projects'), 'deleting OJ Projects mileage still deletes its trip';
END $$;

-- Grants and security settings: nothing for PUBLIC, anon or authenticated; the service role reads and writes.
DO $$
DECLARE
  v_role text;
  v_table text;
  v_privilege text;
  v_function text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_table IN ARRAY ARRAY['public.mileage_drivers', 'public.mileage_vehicles'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        ASSERT NOT has_table_privilege(v_role, v_table, v_privilege), format('%s must not %s %s', v_role, v_privilege, v_table);
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['public.mileage_drivers', 'public.mileage_vehicles'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
      ASSERT has_table_privilege('service_role', v_table, v_privilege), format('the service role can %s %s', v_privilege, v_table);
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['DELETE', 'TRUNCATE'] LOOP
      ASSERT NOT has_table_privilege('service_role', v_table, v_privilege), format('the service role must not %s %s', v_privilege, v_table);
    END LOOP;
    ASSERT NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = v_table::regclass AND a.grantee = 0),
      format('PUBLIC has no grant on %s', v_table);
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table::regclass), format('row level security is on for %s', v_table);
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.mileage_assert_trip_input_v01(date, text, numeric, uuid)',
    'public.create_manual_mileage_trip_v02(date, text, numeric, uuid, jsonb, uuid, uuid)',
    'public.update_manual_mileage_trip_v02(uuid, date, text, numeric, jsonb, uuid, timestamptz)',
    'public.mileage_rate_preview_v01(uuid, date, uuid)',
    'public.fn_sync_oj_mileage_to_trips()'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', v_function, 'EXECUTE'), format('anon must not run %s', v_function);
    ASSERT NOT has_function_privilege('authenticated', v_function, 'EXECUTE'), format('authenticated must not run %s', v_function);
    ASSERT has_function_privilege('service_role', v_function, 'EXECUTE'), format('the service role runs %s', v_function);
    ASSERT (SELECT proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) FROM pg_proc WHERE oid = v_function::regprocedure),
      format('PUBLIC cannot run %s', v_function);
    ASSERT (SELECT proconfig FROM pg_proc WHERE oid = v_function::regprocedure) = ARRAY['search_path=public'],
      format('%s pins search_path=public', v_function);
  END LOOP;

  ASSERT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN (
    'public.mileage_assert_trip_input_v01(date, text, numeric, uuid)'::regprocedure,
    'public.create_manual_mileage_trip_v02(date, text, numeric, uuid, jsonb, uuid, uuid)'::regprocedure,
    'public.update_manual_mileage_trip_v02(uuid, date, text, numeric, jsonb, uuid, timestamptz)'::regprocedure,
    'public.fn_sync_oj_mileage_to_trips()'::regprocedure
  )), 'the save functions and the OJ Projects sync stay SECURITY DEFINER';
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.mileage_rate_preview_v01(uuid, date, uuid)'::regprocedure),
    'the preview runs with the caller''s rights';
END $$;

\echo 'MILEAGE DRIVERS FOUNDATION TESTS PASSED'
