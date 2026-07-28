-- Behavioural proof for find_table_allocation_candidates and allocate_event_communal_seats_v02.
-- Every assertion states the real-world behaviour it protects.
--
-- Owner decisions: TWO opposed orders on one floor.
--   Food bookings     : the Dining Room FIRST (that is where diners should eat), High 4 LAST.
--   Drinks and events : the Dining Room LAST, overflowing into it only once the bar is full.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.pick(
  p_party int,
  p_channel text DEFAULT 'online',
  p_accessible boolean DEFAULT false,
  p_high_chairs int DEFAULT 0,
  p_start timestamptz DEFAULT '2026-09-16 18:00+01',
  p_purpose text DEFAULT 'food'
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT array_to_string(c.table_names, ' + ')
  FROM public.find_table_allocation_candidates(
    p_start, p_start + interval '2 hours', p_party, p_purpose,
    p_high_chairs, p_accessible, NULL, p_channel, NULL, NULL,
    '2026-09-01 12:00+01'::timestamptz
  ) c
  WHERE c.rank = 1;
$$;

DO $$
DECLARE r text;
BEGIN
  -- ===================================================================
  -- 1. Diners go in the dining room. Best fit still decides the band.
  -- ===================================================================
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a', format('party 2 should get Dining Room 4a (priority 10), got %L', r);

  r := pg_temp.pick(4);
  ASSERT r = 'Dining Room 4a', format('party 4 should get Dining Room 4a, got %L', r);

  -- High 4 is now LAST, so it is never the default. The backtest showed it would
  -- otherwise take 50 of 139 bookings, and it is the one table where a high chair
  -- does not fit.
  ASSERT pg_temp.pick(2) <> 'High 4', 'High 4 must never be the first table offered';

  -- ===================================================================
  -- 2. Best fit beats the house order: no wasted seat when a perfect fit exists.
  -- ===================================================================
  r := pg_temp.pick(5);
  ASSERT r = 'Small Bay', format('party 5 should get Small Bay (the only 5-seater), got %L', r);

  r := pg_temp.pick(6);
  ASSERT r = 'Dining Room 6a', format('party 6 should get Dining Room 6a (priority 30) ahead of Big Bay (70), got %L', r);

  -- ===================================================================
  -- 3. Parties of 7 and 8 take the Dining Room pair.
  --    A DELIBERATE reversal of the earlier decision: with the Dining Room now top
  --    priority, the DR pair (worst priority 20) beats the Low pair (worst priority
  --    90) at identical table count and capacity.
  -- ===================================================================
  r := pg_temp.pick(7, 'staff');
  ASSERT r = 'Dining Room 4a + Dining Room 4b',
    format('party 7 should take the Dining Room pair under the new order, got %L', r);

  r := pg_temp.pick(8, 'staff');
  ASSERT r = 'Dining Room 4a + Dining Room 4b', format('party 8 should take the Dining Room pair, got %L', r);

  -- ===================================================================
  -- 4. Minimum party size keeps small parties off the six-tops.
  -- ===================================================================
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'online', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL
      AND (c.table_names && ARRAY['Big Bay','Dining Room 6a','Dining Room 6b','Dining Room 6c'])
  ), 'a party of 2 must never be offered a six-seater while the minimum applies';

  -- ...but it lapses close to the sitting, so a couple is not refused on the night
  -- to protect a large party who is not coming.
  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'online', NULL, NULL,
      '2026-09-16 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND 'Big Bay' = ANY (c.table_names)
  ), 'within the release window a party of 2 should be able to have Big Bay';

  -- ===================================================================
  -- 5. THE CRITICAL FIX. A private booking over the Dining Room must not stop a
  --    couple booking the bar. Before this, the allocator picked a blocked table
  --    and the whole booking failed with no_table.
  -- ===================================================================
  INSERT INTO public.test_private_blocks (table_id, starts_at, ends_at)
  SELECT id, '2026-09-16 17:00+01', '2026-09-16 23:00+01'
  FROM public.tables WHERE name LIKE 'Dining Room%';

  r := pg_temp.pick(2, 'staff');
  ASSERT r = 'Low 4a',
    format('with the Dining Room held by a function, a party of 2 must fall through to the bar; got %L', r);

  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.reason_code = 'table_private_block'
  ), 'blocked Dining Room tables must be reported as table_private_block, not silently dropped';

  r := pg_temp.pick(7, 'staff');
  ASSERT r = 'Low 4a + Low 4b',
    format('party 7 with the Dining Room blocked should fall back to the Low pair; got %L', r);

  DELETE FROM public.test_private_blocks;

  -- ===================================================================
  -- 6. Accessibility. Small Bay has a step; High 4 is bar height.
  -- ===================================================================
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, true, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL
      AND (c.table_names && ARRAY['Small Bay','High 4'])
  ), 'an accessible-table request must exclude Small Bay (step) and High 4 (bar height)';

  -- ===================================================================
  -- 7. High chairs. High 4 cannot take one.
  -- ===================================================================
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 3, 'food', 1, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND 'High 4' = ANY (c.table_names)
  ), 'a booking with a high chair must never be offered High 4';

  -- ===================================================================
  -- 8. Occupancy, and the no-show fix.
  -- ===================================================================
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, start_datetime, end_datetime)
  VALUES ('11111111-1111-1111-1111-111111111111','2026-09-16','18:00',2,'confirmed','2026-09-16 18:00+01','2026-09-16 20:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('11111111-1111-1111-1111-111111111111','39350c06-d5ea-4cea-a742-9ea78ebc0557','2026-09-16 18:00+01','2026-09-16 20:15+01');

  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4b', format('with Dining Room 4a taken, the next party goes to 4b; got %L', r);

  UPDATE public.table_bookings SET status = 'no_show' WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a', format('a no-show must free its table for the next booking; got %L', r);

  UPDATE public.table_bookings SET status = 'confirmed', left_at = '2026-09-16 19:00+01'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a', format('a booking whose guests have left must free its table; got %L', r);

  UPDATE public.table_bookings
     SET status = 'pending_payment', left_at = NULL,
         hold_expires_at = '2026-09-01 09:00+01', payment_status = 'pending'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a', format('an expired UNPAID hold must release its table; got %L', r);

  UPDATE public.table_bookings SET payment_status = 'completed'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4b',
    format('an expired hold whose deposit is PAID must keep its table; got %L', r);

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  -- ===================================================================
  -- 9. Half-open windows and the turnaround gap.
  -- ===================================================================
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, start_datetime, end_datetime)
  VALUES ('22222222-2222-2222-2222-222222222222','2026-09-16','16:00',2,'confirmed','2026-09-16 16:00+01','2026-09-16 18:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('22222222-2222-2222-2222-222222222222','39350c06-d5ea-4cea-a742-9ea78ebc0557','2026-09-16 16:00+01','2026-09-16 18:00+01');

  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a', format('a booking ending exactly at 18:00 must not block one starting at 18:00; got %L', r);

  UPDATE public.booking_table_assignments SET end_datetime = '2026-09-16 18:15+01';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4b', format('with the 15 minute turnaround gap the table is still held; got %L', r);

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  -- ===================================================================
  -- 10. Large parties. The Dining Room reaches 26 seats.
  -- ===================================================================
  ASSERT (SELECT total_capacity FROM public.find_table_allocation_candidates(
            '2026-09-16 18:00+01','2026-09-16 20:00+01',20,'food',0,false,NULL,'staff',NULL,NULL,
            '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1) >= 20,
    'the winning combination for a party of 20 must actually seat 20';

  -- 27 cannot be joined: Big Bay, Small Bay and High 4 link to nothing.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01',27,'food',0,false,NULL,'staff',NULL,NULL,
      '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1
  ), 'a party of 27 has no joined combination';

  -- ...unless staff drop the adjacency requirement. This is the
  -- "in a live situation we would never turn that away" case.
  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01',27,'food',0,false,NULL,'staff',NULL,
      ROW(false,false,true,false)::public.table_allocation_overrides,
      '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1
  ), 'with allow_unjoined, staff must be able to seat a party of 27 across separated tables';

  -- ===================================================================
  -- 11. A staff-picked table is promoted.
  -- ===================================================================
  ASSERT (SELECT array_to_string(table_names,' + ') FROM public.find_table_allocation_candidates(
            '2026-09-16 18:00+01','2026-09-16 20:00+01',2,'food',0,false,
            ARRAY['8ff55f2a-86cb-4b2d-ae74-2d8cae44499b'::uuid],'staff',NULL,NULL,
            '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1) = 'Low 4b',
    'a table the staff explicitly picked must rank first';

  -- ===================================================================
  -- 12. Determinism.
  -- ===================================================================
  ASSERT pg_temp.pick(7,'staff') = pg_temp.pick(7,'staff'), 'ranking must be deterministic';

  -- ===================================================================
  -- 13. DRINKS fill the bar first and overflow into the Dining Room only
  --     once the bar is full. Same party, same time, different purpose,
  --     opposite end of the pub.
  -- ===================================================================
  r := pg_temp.pick(2, 'staff', false, 0, '2026-09-16 18:00+01', 'drinks');
  ASSERT r = 'Low 4a', format('a drinks pair should get Low 4a (bar_priority 10), got %L', r);

  ASSERT pg_temp.pick(2, 'staff', false, 0, '2026-09-16 18:00+01', 'food') = 'Dining Room 4a'
     AND pg_temp.pick(2, 'staff', false, 0, '2026-09-16 18:00+01', 'drinks') = 'Low 4a',
    'the same party at the same time must go to opposite ends of the pub depending on purpose';

  -- Fill every bar table, then a drinks booking must overflow into the Dining Room
  -- rather than be refused.
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, booking_purpose, start_datetime, end_datetime)
  SELECT gen_random_uuid(), '2026-09-16', '18:00', 2, 'confirmed', 'drinks',
         '2026-09-16 18:00+01', '2026-09-16 20:00+01'
  FROM generate_series(1, 5);

  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  SELECT tb.id, t.id, '2026-09-16 18:00+01', '2026-09-16 20:15+01'
  FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM public.table_bookings) tb
  JOIN (SELECT id, row_number() OVER (ORDER BY bar_priority) rn
        FROM public.tables
        WHERE name IN ('Low 4a','Low 4b','High 4','Small Bay','Big Bay')) t ON t.rn = tb.rn;

  r := pg_temp.pick(2, 'staff', false, 0, '2026-09-16 18:00+01', 'drinks');
  ASSERT r LIKE 'Dining Room%',
    format('with the whole bar taken, a drinks booking must overflow into the Dining Room, not be refused; got %L', r);

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  RAISE NOTICE 'ALL ALLOCATION TESTS PASSED';
END;
$$;

-- =====================================================================
-- Events fill the OPPOSITE way round, so a quiz night does not consume
-- the dining space that food bookings need.
-- =====================================================================
DO $$
DECLARE
  v_result jsonb;
  v_names  text;
BEGIN
  INSERT INTO public.bookings (id, status) VALUES
    ('33333333-3333-3333-3333-333333333333', 'confirmed');

  v_result := public.allocate_event_communal_seats_v02(
    '44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333',
    12,
    '2026-09-16 19:00+01', '2026-09-16 22:00+01'
  );

  ASSERT v_result ->> 'state' = 'confirmed',
    format('a 12-seat event should be seatable, got %s', v_result);

  v_names := v_result ->> 'table_name';

  ASSERT v_names NOT LIKE '%Dining Room%',
    format('a 12-seat event must take the bar tables, never the Dining Room; got %L', v_names);

  ASSERT v_names LIKE '%Low 4a%' AND v_names LIKE '%Low 4b%' AND v_names LIKE '%High 4%',
    format('a 12-seat event should fill Low 4a, Low 4b and High 4; got %L', v_names);

  -- A big event does eventually reach the Dining Room, but only after everything
  -- else is gone.
  DELETE FROM public.event_communal_seat_allocations;
  v_result := public.allocate_event_communal_seats_v02(
    '44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333',
    30,
    '2026-09-16 19:00+01', '2026-09-16 22:00+01'
  );
  ASSERT v_result ->> 'state' = 'confirmed', 'a 30-seat event should still fit across the whole pub';
  ASSERT (v_result ->> 'table_name') LIKE '%Low 4a%',
    'a large event must still start from the bar tables';

  DELETE FROM public.event_communal_seat_allocations;
  DELETE FROM public.bookings;

  RAISE NOTICE 'ALL EVENT ALLOCATION TESTS PASSED';
END;
$$;
