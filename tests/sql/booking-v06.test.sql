-- Behavioural proof for create_table_booking_v06 and its public/staff split.

\set ON_ERROR_STOP on

DO $$
DECLARE
  r         jsonb;
  v_cust    uuid := gen_random_uuid();
  -- Pinned to a WEDNESDAY. Sunday adds a turn-time uplift, so a floating date would make
  -- the duration assertions pass or fail depending on when the suite happens to run.
  v_date    date := (CURRENT_DATE + 30) + ((3 - EXTRACT(DOW FROM CURRENT_DATE + 30)::int + 7) % 7);
BEGIN
  -- ===================================================================
  -- THE GATE. Off means v05, end to end. Deploying this changes nothing.
  -- ===================================================================
  ASSERT public.get_setting_bool('table_allocation_v06_enabled', false) = false,
    'the flag must ship false';

  r := public.create_table_booking_public_v06(v_cust, v_date, '18:00', 2);
  ASSERT r ->> 'reason' = 'v05_stub_called',
    format('with the flag off, the call must go to v05 untouched; got %s', r);

  -- Turn it on for the rest.
  UPDATE public.system_settings SET value = '{"value": true}'
   WHERE key = 'table_allocation_v06_enabled';

  -- ===================================================================
  -- A booking actually happens, on the right table.
  -- ===================================================================
  r := public.create_table_booking_public_v06(v_cust, v_date, '18:00', 2);
  ASSERT r ->> 'state' = 'confirmed', format('a normal booking should confirm; got %s', r);
  ASSERT r ->> 'table_name' = 'Dining Room 4a',
    format('a food booking for 2 should get Dining Room 4a; got %s', r ->> 'table_name');
  ASSERT (r ->> 'booking_reference') LIKE 'TB-%', 'a reference should be issued';

  -- ...and it holds the table, so the next identical booking gets a different one.
  r := public.create_table_booking_public_v06(v_cust, v_date, '18:00', 2);
  ASSERT r ->> 'table_name' = 'Dining Room 4b',
    format('the second booking must not get the same table; got %s', r ->> 'table_name');

  -- ===================================================================
  -- Drinks go to the bar, at the same time on the same day.
  -- ===================================================================
  r := public.create_table_booking_public_v06(v_cust, v_date, '18:00', 2, 'drinks');
  ASSERT r ->> 'table_name' LIKE 'Low%',
    format('a drinks booking should fill the bar first; got %s', r ->> 'table_name');
  ASSERT (r ->> 'booking_purpose') = 'drinks', 'purpose should be recorded';

  -- ===================================================================
  -- THE SECURITY SPLIT. The public function cannot be told who is calling.
  -- ===================================================================
  -- 21 is refused publicly...
  r := public.create_table_booking_public_v06(v_cust, v_date, '19:00', 21);
  ASSERT r ->> 'reason' = 'too_large_party',
    format('the public path must refuse 21; got %s', r);

  -- ...and accepted by staff, whose ceiling is 40.
  r := public.create_table_booking_staff_v06(
         v_cust, v_date, '19:00', 21, 'food', NULL, false, 'admin',
         false, true, true, 0, false, false, 'staff', false,
         ROW(false, false, true, false)::public.table_allocation_overrides, NULL);
  ASSERT r ->> 'state' IN ('confirmed', 'pending_payment'),
    format('staff must be able to take a party of 21; got %s', r);

  -- The staff entry point cannot pretend to be an online booking, so it can never
  -- be used to dodge the online rules by relabelling itself.
  r := public.create_table_booking_staff_v06(
         v_cust, v_date, '20:00', 2, 'food', NULL, false, 'admin',
         false, false, true, 0, false, false, 'online', false, NULL, NULL);
  ASSERT r ->> 'state' = 'confirmed', format('a staff booking should still work; got %s', r);

  -- ===================================================================
  -- Accessibility survives all the way to the row.
  -- ===================================================================
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '20:30', 2, 'food', NULL, false, 'brand_site',
         false, false, false, 0, false, true);
  ASSERT r ->> 'state' = 'confirmed', format('an accessible booking should confirm; got %s', r);
  ASSERT (r ->> 'requires_accessible_table')::boolean = true,
    'the accessibility flag must come back in the response';
  ASSERT (r ->> 'table_name') NOT IN ('Small Bay', 'High 4'),
    format('an accessible booking must avoid the step and the stools; got %s', r ->> 'table_name');
  ASSERT (SELECT requires_accessible_table FROM public.table_bookings
           WHERE id = (r ->> 'table_booking_id')::uuid) = true,
    'the accessibility requirement must be stored on the booking';

  -- ===================================================================
  -- High chairs never block, and a shortfall is reported rather than hidden.
  -- ===================================================================
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '13:00', 3, 'food', NULL, false, 'brand_site',
         false, false, false, 5, false, false);
  ASSERT r ->> 'state' = 'confirmed', 'asking for more high chairs than exist must never refuse a booking';
  ASSERT (r ->> 'high_chairs_granted')::int = 2, 'only the two that exist can be granted';
  ASSERT (r ->> 'high_chairs_short')::int = 3,
    'the shortfall must be reported, so the family is not surprised on arrival';

  -- ===================================================================
  -- Outside is capped, which v05 never was.
  -- ===================================================================
  -- Drinks, so the kitchen pacing ceiling is not what stops us: this test is about the
  -- OUTSIDE cap. (Outside food bookings do still count towards kitchen pacing, correctly,
  -- which is what a first version of this test tripped over.)
  FOR i IN 1..5 LOOP
    r := public.create_table_booking_public_v06(
           v_cust, v_date, '15:00', 4, 'drinks', NULL, false, 'brand_site',
           false, false, false, 0, true, false);
    ASSERT r ->> 'state' = 'confirmed', format('outside booking %s should confirm; got %s', i, r);
  END LOOP;

  r := public.create_table_booking_public_v06(
         v_cust, v_date, '15:00', 4, 'drinks', NULL, false, 'brand_site',
         false, false, false, 0, true, false);
  ASSERT r ->> 'reason' = 'outside_full',
    format('the sixth outside booking must be refused; got %s', r);

  -- ===================================================================
  -- Turn times and the turnaround gap: the guest is told the shorter time.
  -- ===================================================================
  -- Own the settings this suite asserts on. The suites share one database, and the settings
  -- suite deliberately leaves the turn times at 200/210/220/230 while testing partial updates.
  -- Depending on another suite's leftovers is how a test starts lying.
  UPDATE public.system_settings SET value = '{"value": true}' WHERE key = 'turn_times_enabled';
  UPDATE public.system_settings SET value = '{"value": 90}'  WHERE key = 'turn_time_minutes_1_2';
  UPDATE public.system_settings SET value = '{"value": 105}' WHERE key = 'turn_time_minutes_3_4';
  UPDATE public.system_settings SET value = '{"value": 120}' WHERE key = 'turn_time_minutes_5_6';
  UPDATE public.system_settings SET value = '{"value": 150}' WHERE key = 'turn_time_minutes_7_plus';
  UPDATE public.system_settings SET value = '{"value": 15}'  WHERE key = 'turnaround_gap_minutes';

  ASSERT EXTRACT(DOW FROM v_date)::int = 3, 'the test date must be a Wednesday';

  r := public.create_table_booking_public_v06(v_cust, v_date, '16:00', 2);
  ASSERT r ->> 'state' = 'confirmed', format('a booking with turn times should confirm; got %s', r);
  ASSERT (SELECT duration_minutes FROM public.table_bookings
           WHERE id = (r ->> 'table_booking_id')::uuid) = 90,
    format('a party of two should be given 90 minutes; booking=%s stored=%s',
           r ->> 'table_booking_id',
           (SELECT duration_minutes FROM public.table_bookings
             WHERE id = (r ->> 'table_booking_id')::uuid));

  ASSERT (SELECT bta.end_datetime - tb.end_datetime
            FROM public.booking_table_assignments bta
            JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
           WHERE tb.id = (r ->> 'table_booking_id')::uuid) = interval '15 minutes',
    'the table must be held 15 minutes longer than the guest is told';

  RAISE NOTICE 'ALL V06 BOOKING TESTS PASSED';
END;
$$;
