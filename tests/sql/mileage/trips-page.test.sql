-- Release 5: filters, sorting, paging, totals, input validation and grants for the trips page.
-- Works before and after the Release 3 cutover makes mileage_trips.driver_id NOT NULL: every test
-- trip has a driver.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_a uuid;
  v_b uuid;
  v_home uuid;
  v_shop uuid;
  v_depot uuid;
  v_second uuid;
  v_result jsonb;
BEGIN
  DELETE FROM public.mileage_trips;
  -- Fresh drivers with names no other test uses, so an earlier test cannot leave them inactive.
  INSERT INTO public.mileage_drivers (display_name) VALUES ('Trips page driver A') RETURNING id INTO v_a;
  INSERT INTO public.mileage_drivers (display_name) VALUES ('Trips page driver B') RETURNING id INTO v_b;
  -- The harness has no home base; an earlier test may have left one. Either way, give it a
  -- known name inside this transaction so search results are predictable.
  UPDATE public.mileage_destinations SET name = 'Trips page home' WHERE is_home_base RETURNING id INTO v_home;
  IF v_home IS NULL THEN
    INSERT INTO public.mileage_destinations (name, is_home_base) VALUES ('Trips page home', true) RETURNING id INTO v_home;
  END IF;
  INSERT INTO public.mileage_destinations (name) VALUES ('Page shop') RETURNING id INTO v_shop;
  INSERT INTO public.mileage_destinations (name) VALUES ('100% Depot') RETURNING id INTO v_depot;

  -- Four trips: two for driver A to Page shop, one for driver B to the depot, one route-less.
  PERFORM public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Supplies', 3.4, NULL,
    jsonb_build_array(jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 1.7),
                      jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 1.7)),
    v_a, gen_random_uuid());
  v_second := (public.create_manual_mileage_trip_v02(DATE '2026-05-01', 'Second run', 10.0, NULL,
    jsonb_build_array(jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_shop, 'miles', 5.0),
                      jsonb_build_object('from_destination_id', v_shop, 'to_destination_id', v_home, 'miles', 5.0)),
    v_a, gen_random_uuid()) ->> 'id')::uuid;
  -- now() is fixed for the whole transaction, so both same-day trips would share a created time.
  -- Make the second one later, so the created-time tie-break is what the test proves.
  UPDATE public.mileage_trips SET created_at = created_at + INTERVAL '1 second' WHERE id = v_second;
  PERFORM public.create_manual_mileage_trip_v02(DATE '2026-06-10', 'Wholesale order', 30.0, NULL,
    jsonb_build_array(jsonb_build_object('from_destination_id', v_home, 'to_destination_id', v_depot, 'miles', 15.0),
                      jsonb_build_object('from_destination_id', v_depot, 'to_destination_id', v_home, 'miles', 15.0)),
    v_b, gen_random_uuid());
  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, driver_id, driver_basis)
  VALUES (DATE '2026-07-02', 'No route', 1.0, 1.0, 0, 0, 'manual', v_a, 'owner_statement');

  -- Everything, newest first; totals cover all four trips.
  v_result := public.mileage_trips_page_v01('{}'::jsonb, 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 4, 'four trips in total';
  ASSERT (v_result -> 'totals' ->> 'trips')::int = 4, 'the totals count every trip';
  ASSERT (v_result -> 'totals' ->> 'miles_tenths')::int = 444, '3.4 + 10.0 + 30.0 + 1.0 miles';
  ASSERT (v_result -> 'totals' ->> 'amount_pence')::int = 2442, '44.4 miles at 55p';
  ASSERT v_result -> 'rows' -> 0 ->> 'description' = 'No route', 'newest trip first';
  ASSERT v_result -> 'rows' -> 2 ->> 'description' = 'Second run', 'same-day trips break ties on created time, newest first';
  ASSERT v_result -> 'rows' -> 3 ->> 'description' = 'Supplies', 'the earliest trip comes last';
  ASSERT v_result -> 'rows' -> 0 = (SELECT r.row_json FROM public.mileage_trip_rows_v01 r WHERE r.description = 'No route'),
    'rows come back in the Release 4 dataset trip shape';

  v_result := public.mileage_trips_page_v01('{}'::jsonb, 'date', 'asc', 25, 0);
  ASSERT v_result -> 'rows' -> 0 ->> 'description' = 'Supplies'
    AND v_result -> 'rows' -> 1 ->> 'description' = 'Second run', 'ascending breaks ties on created time, oldest first';

  -- Sorting by miles covers every trip, not only the page.
  v_result := public.mileage_trips_page_v01('{}'::jsonb, 'miles', 'desc', 1, 0);
  ASSERT jsonb_array_length(v_result -> 'rows') = 1, 'one row per page';
  ASSERT v_result -> 'rows' -> 0 ->> 'description' = 'Wholesale order', 'the longest trip comes first';
  ASSERT (v_result -> 'totals' ->> 'trips')::int = 4, 'totals ignore paging';

  v_result := public.mileage_trips_page_v01('{}'::jsonb, 'amount', 'asc', 25, 2);
  ASSERT jsonb_array_length(v_result -> 'rows') = 2, 'offset skips the first two rows';
  ASSERT v_result -> 'rows' -> 0 ->> 'description' = 'Second run', 'the third cheapest trip starts the offset page';

  v_result := public.mileage_trips_page_v01('{}'::jsonb, 'date', 'desc', 25, 100);
  ASSERT v_result -> 'rows' = '[]'::jsonb, 'a page past the end is an empty array, not null';
  ASSERT (v_result ->> 'total_count')::int = 4, 'a page past the end still reports the total, so the app can go to the last page';

  -- Filters.
  v_result := public.mileage_trips_page_v01(jsonb_build_object('from', '2026-05-01', 'to', '2026-05-31'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 2, 'two trips in May';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('from', '2026-06-10'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 2, 'from is inclusive';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('to', '2026-06-10'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 3, 'to is inclusive';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('driver_id', v_b::text), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 1, 'one trip for driver B';
  ASSERT (v_result -> 'totals' ->> 'amount_pence')::int = 1650, '30.0 mi at 55p';
  ASSERT (v_result -> 'totals' ->> 'miles_tenths')::int = 300, 'the totals follow the filters';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('place_id', v_shop::text), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 2, 'two trips visit Page shop';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('place_id', v_shop::text, 'driver_id', v_b::text), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 0, 'filters combine: driver B never visits Page shop';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('search', 'page SHOP'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 2, 'search matches place names regardless of case';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('search', 'wholesale'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 1, 'search matches the reason';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('search', '%'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 1, 'a percent sign is matched literally (only "100% Depot")';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('search', '_'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 0, 'an underscore is matched literally, not as any character';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('source', 'manual'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 4, 'every trip here is manual';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('source', 'oj_projects'), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 0, 'no OJ Projects trips in this data';
  ASSERT v_result -> 'rows' = '[]'::jsonb, 'no rows is an empty array, not null';
  ASSERT (v_result -> 'totals' ->> 'miles_tenths')::int = 0, 'empty miles total is zero, not null';
  ASSERT (v_result -> 'totals' ->> 'amount_pence')::int = 0, 'empty totals are zero, not null';

  v_result := public.mileage_trips_page_v01(
    jsonb_build_object('from', '', 'to', '', 'search', '   ', 'place_id', '', 'driver_id', '', 'source', ''),
    'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 4, 'empty strings count as no filter';

  v_result := public.mileage_trips_page_v01(jsonb_build_object('from', NULL, 'driver_id', NULL), 'date', 'desc', 25, 0);
  ASSERT (v_result ->> 'total_count')::int = 4, 'JSON nulls count as no filter';
END $$;

ROLLBACK;

-- Validation: every bad input is refused, never widened.
DO $$
DECLARE
  v_case record;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      (NULL::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('[]'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"colour": "red"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"from": "2026-02-30"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"from": "today"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"to": "infinity"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"from": "2026-5-1"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"from": "2026-06-01", "to": "2026-05-01"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"place_id": "not-a-uuid"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"driver_id": "1"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"source": "email"}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"search": 5}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{"source": ["manual"]}'::jsonb, 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      (jsonb_build_object('search', repeat('x', 81)), 'date', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_FILTERS'),
      ('{}'::jsonb, 'route; drop table mileage_trips', 'desc', 25, 0, 'MILEAGE_LIST_INVALID_SORT'),
      ('{}'::jsonb, NULL, 'desc', 25, 0, 'MILEAGE_LIST_INVALID_SORT'),
      ('{}'::jsonb, 'date', 'sideways', 25, 0, 'MILEAGE_LIST_INVALID_SORT'),
      ('{}'::jsonb, 'date', NULL, 25, 0, 'MILEAGE_LIST_INVALID_SORT'),
      ('{}'::jsonb, 'date', 'desc', 0, 0, 'MILEAGE_LIST_INVALID_PAGE'),
      ('{}'::jsonb, 'date', 'desc', 5001, 0, 'MILEAGE_LIST_INVALID_PAGE'),
      ('{}'::jsonb, 'date', 'desc', NULL, 0, 'MILEAGE_LIST_INVALID_PAGE'),
      ('{}'::jsonb, 'date', 'desc', 25, -1, 'MILEAGE_LIST_INVALID_PAGE'),
      ('{}'::jsonb, 'date', 'desc', 25, 1000001, 'MILEAGE_LIST_INVALID_PAGE'),
      ('{}'::jsonb, 'date', 'desc', 25, NULL, 'MILEAGE_LIST_INVALID_PAGE')
    ) AS cases(filters, sort, direction, lim, off, expected)
  LOOP
    BEGIN
      PERFORM public.mileage_trips_page_v01(v_case.filters, v_case.sort, v_case.direction, v_case.lim, v_case.off);
      RAISE EXCEPTION 'expected %', v_case.expected;
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = v_case.expected OR SQLERRM LIKE v_case.expected || ': %',
        format('expected %s for %s %s %s %s %s, got %s', v_case.expected, v_case.filters, v_case.sort, v_case.direction, v_case.lim, v_case.off, SQLERRM);
    END;
  END LOOP;

  -- The boundaries themselves are accepted.
  PERFORM public.mileage_trips_page_v01('{}'::jsonb, 'date', 'desc', 1, 0);
  PERFORM public.mileage_trips_page_v01('{}'::jsonb, 'date', 'desc', 5000, 1000000);
  PERFORM public.mileage_trips_page_v01(jsonb_build_object('search', repeat('x', 80)), 'date', 'desc', 25, 0);
  PERFORM public.mileage_trips_page_v01(jsonb_build_object('from', '2026-05-01', 'to', '2026-05-01'), 'date', 'desc', 25, 0);
END $$;

-- Grants and security settings: nothing for PUBLIC, anon or authenticated; the service role runs it.
DO $$
DECLARE
  v_function constant text := 'public.mileage_trips_page_v01(jsonb, text, text, integer, integer)';
BEGIN
  ASSERT NOT has_function_privilege('anon', v_function, 'EXECUTE'), 'anon must not list trips';
  ASSERT NOT has_function_privilege('authenticated', v_function, 'EXECUTE'), 'authenticated must not list trips';
  ASSERT has_function_privilege('service_role', v_function, 'EXECUTE'), 'the service role lists trips';
  ASSERT (SELECT proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) FROM pg_proc WHERE oid = v_function::regprocedure),
    'PUBLIC cannot list trips';
  ASSERT (SELECT NOT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = v_function::regprocedure),
    'the trips page is STABLE, runs with the caller''s rights and pins search_path=public';
END $$;

-- Not only the catalogue: a call as anon or authenticated is refused at the function itself.
BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.mileage_trips_page_v01('{}'::jsonb, 'date', 'desc', 25, 0);
  EXCEPTION WHEN insufficient_privilege THEN
    ASSERT SQLERRM LIKE 'permission denied for function%', format('anon was refused for the wrong reason: %s', SQLERRM);
    v_refused := true;
  END;
  ASSERT v_refused, 'anon ran the trips page';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN
    PERFORM public.mileage_trips_page_v01('{}'::jsonb, 'date', 'desc', 25, 0);
  EXCEPTION WHEN insufficient_privilege THEN
    ASSERT SQLERRM LIKE 'permission denied for function%', format('authenticated was refused for the wrong reason: %s', SQLERRM);
    v_refused := true;
  END;
  ASSERT v_refused, 'authenticated ran the trips page';
END $$;
ROLLBACK;

\echo 'MILEAGE TRIPS PAGE TESTS PASSED'
