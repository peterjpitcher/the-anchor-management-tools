-- Behavioural proof for check_table_availability_v06.
--
-- The single most important property in this whole release: if availability says a slot is
-- available, create must succeed. That is the false-availability defect, tested directly.

\set ON_ERROR_STOP on

DO $$
DECLARE
  a         jsonb;
  r         jsonb;
  slot      jsonb;
  v_cust    uuid := gen_random_uuid();
  -- Wednesday, so no Sunday turn-time uplift.
  v_date    date := (CURRENT_DATE + 60) + ((3 - EXTRACT(DOW FROM CURRENT_DATE + 60)::int + 7) % 7);
  v_taken   integer := 0;
BEGIN
  UPDATE public.system_settings SET value = '{"value": true}'
   WHERE key = 'table_allocation_v06_enabled';
  UPDATE public.system_settings SET value = '{"value": false}'
   WHERE key = 'kitchen_pacing_enabled';

  -- ===================================================================
  -- 1. It answers at all, and it is party-size aware, which the live
  --    availability endpoint is not.
  -- ===================================================================
  a := public.check_table_availability_v06(v_date, 2);
  ASSERT a ->> 'calculation_state' = 'complete', format('expected a complete calculation; got %s', a);
  ASSERT jsonb_array_length(a -> 'slots') > 0, 'a normal Wednesday should have slots';
  ASSERT (a ->> 'party_size')::int = 2, 'the party size must come back';

  -- ===================================================================
  -- 2. Internal reasons NEVER leave. A private booking must look like an
  --    ordinary full house, not like a disclosed function.
  -- ===================================================================
  INSERT INTO public.test_private_blocks (table_id, starts_at, ends_at)
  SELECT id, (v_date + time '00:00') AT TIME ZONE 'Europe/London',
             (v_date + time '23:59') AT TIME ZONE 'Europe/London'
  FROM public.tables WHERE COALESCE(is_bookable, true);

  a := public.check_table_availability_v06(v_date, 2);

  ASSERT NOT (a::text LIKE '%private%'), 'a private booking must never be disclosed to a customer';
  ASSERT NOT (a::text LIKE '%maintenance%'), 'maintenance must never be disclosed to a customer';
  ASSERT NOT (a::text LIKE '%table_occupied%'), 'internal reason codes must not leave the database';

  FOR slot IN SELECT * FROM jsonb_array_elements(a -> 'slots') LOOP
    ASSERT slot ->> 'state' = 'unavailable',
      'with every table blocked, no slot can be available';
    ASSERT slot ->> 'public_reason' = 'tables_full',
      format('a blocked table must surface as tables_full; got %s', slot ->> 'public_reason');
    ASSERT length(slot ->> 'message') > 0, 'every unavailable slot must carry a customer message';
  END LOOP;

  DELETE FROM public.test_private_blocks;

  -- ===================================================================
  -- 3. THE POINT OF THE RELEASE. Availability and create must agree.
  --    Every slot marked available must actually book.
  -- ===================================================================
  -- Availability is a SNAPSHOT, and each booking changes the state it was computed against,
  -- so it is re-read before every create. Reading once and then booking six slots would be
  -- testing stale data, not parity.
  WHILE v_taken < 6 LOOP
    a := public.check_table_availability_v06(v_date, 2);

    SELECT s INTO slot
      FROM jsonb_array_elements(a -> 'slots') s
     WHERE s ->> 'state' = 'available'
     LIMIT 1;

    EXIT WHEN slot IS NULL;

    r := public.create_table_booking_public_v06(
           v_cust, v_date, (slot ->> 'time')::time, 2);

    ASSERT r ->> 'state' IN ('confirmed', 'pending_payment'),
      format('availability offered %s but create refused it with %s. This is the exact defect this release exists to remove.',
             slot ->> 'time', r ->> 'reason');

    v_taken := v_taken + 1;
    slot := NULL;
  END LOOP;

  ASSERT v_taken > 0, 'the test proved nothing if no slot was available to book';

  -- ===================================================================
  -- 4. Availability MOVES once tables are taken. The live endpoint never
  --    changes, because it only counts kitchen covers.
  -- ===================================================================
  -- Fill every table for one window, then that slot must close.
  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, booking_purpose, start_datetime, end_datetime)
  SELECT gen_random_uuid(), v_date, '18:00', 2, 'confirmed', 'food',
         (v_date + time '18:00') AT TIME ZONE 'Europe/London',
         (v_date + time '20:00') AT TIME ZONE 'Europe/London'
  FROM public.tables WHERE COALESCE(is_bookable, true);

  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  SELECT tb.id, t.id,
         (v_date + time '18:00') AT TIME ZONE 'Europe/London',
         (v_date + time '20:15') AT TIME ZONE 'Europe/London'
  FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM public.table_bookings) tb
  JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM public.tables WHERE COALESCE(is_bookable, true)) t
    ON t.rn = tb.rn;

  a := public.check_table_availability_v06(v_date, 2);
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a -> 'slots') s
    WHERE s ->> 'time' = '18:00' AND s ->> 'state' = 'unavailable'
  ), 'with every table taken at 18:00, that slot must close';

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  -- ===================================================================
  -- 5. A party too big for the website goes to the private-booking route,
  --    not a bare refusal.
  -- ===================================================================
  a := public.check_table_availability_v06(v_date, 25);
  ASSERT a ->> 'public_reason' = 'too_large',
    format('a party of 25 online should be routed to private hire; got %s', a);
  ASSERT jsonb_array_length(a -> 'slots') = 0, 'no slots should be offered above the online ceiling';

  -- ===================================================================
  -- 6. High chairs are DISCLOSED per slot, never a reason to refuse.
  --    The owner: they only have two, so guests must know before booking.
  -- ===================================================================
  a := public.check_table_availability_v06(v_date, 3, 'food', false, false, 1);
  slot := (a -> 'slots' -> 0);
  ASSERT slot ? 'high_chairs_remaining', 'every slot must report how many high chairs are left';
  ASSERT (slot ->> 'high_chairs_remaining')::int = 2, 'both high chairs should be free to start with';

  -- ===================================================================
  -- 7. Closed days say so, with a customer message.
  -- ===================================================================
  INSERT INTO public.special_hours (date, is_closed) VALUES (v_date + 1, true)
  ON CONFLICT (date) DO UPDATE SET is_closed = true;

  a := public.check_table_availability_v06(v_date + 1, 2);
  ASSERT a ->> 'public_reason' = 'closed', format('a closed day should say closed; got %s', a);
  ASSERT length(a ->> 'message') > 0, 'a closed day needs a customer message';

  DELETE FROM public.special_hours WHERE date = v_date + 1;

  -- ===================================================================
  -- 8. Food and drinks can differ, now they use opposite house orders.
  -- ===================================================================
  a := public.check_table_availability_v06(v_date, 2, 'drinks');
  ASSERT a ->> 'calculation_state' = 'complete', 'drinks availability should compute';
  ASSERT jsonb_array_length(a -> 'slots') > 0, 'drinks should have slots';

  -- ===================================================================
  -- 9. Never fail open. A nonsense request is unknown, not available.
  -- ===================================================================
  a := public.check_table_availability_v06(v_date, 0);
  ASSERT a ->> 'calculation_state' = 'unknown',
    format('an invalid party size must be unknown, never available; got %s', a);
  ASSERT jsonb_array_length(a -> 'slots') = 0, 'unknown must offer nothing selectable';

  RAISE NOTICE 'ALL AVAILABILITY TESTS PASSED';
END;
$$;
