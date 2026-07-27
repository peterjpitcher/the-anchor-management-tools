-- Behavioural proof for find_table_allocation_candidates.
-- Every assertion states the real-world behaviour it protects.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.pick(
  p_party int,
  p_channel text DEFAULT 'online',
  p_accessible boolean DEFAULT false,
  p_high_chairs int DEFAULT 0,
  p_start timestamptz DEFAULT '2026-09-16 18:00+01'
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT array_to_string(c.table_names, ' + ')
  FROM public.find_table_allocation_candidates(
    p_start, p_start + interval '2 hours', p_party, 'food',
    p_high_chairs, p_accessible, NULL, p_channel, NULL, NULL,
    '2026-09-01 12:00+01'::timestamptz
  ) c
  WHERE c.rank = 1;
$$;

DO $$
DECLARE r text;
BEGIN
  -- ===================================================================
  -- 1. Best fit first, then the house order.
  --    Low 4a and High 4 are held for walk-ins, so online small parties
  --    start at Low 4b (priority 30).
  -- ===================================================================
  r := pg_temp.pick(2);
  ASSERT r = 'Low 4b', format('party 2 online should get Low 4b (Low 4a and High 4 are held), got %L', r);

  r := pg_temp.pick(4);
  ASSERT r = 'Low 4b', format('party 4 online should get Low 4b, got %L', r);

  -- Staff are not subject to walk-in holds, so the house order runs in full.
  r := pg_temp.pick(2, 'staff');
  ASSERT r = 'High 4', format('party 2 staff should get High 4 (priority 10), got %L', r);

  -- ===================================================================
  -- 2. Best fit beats house order. A five wastes no seat on a six-top.
  -- ===================================================================
  r := pg_temp.pick(5);
  ASSERT r = 'Small Bay', format('party 5 should get Small Bay (capacity 5), got %L', r);

  r := pg_temp.pick(6);
  ASSERT r = 'Big Bay', format('party 6 should get Big Bay (priority 50, ahead of the Dining Room six-tops), got %L', r);

  -- ===================================================================
  -- 3. THE HEADLINE FIX. Parties of 7 and 8 must take Low 4a + Low 4b,
  --    not Dining Room 4a + 4b. Both pairs are 2 tables and 8 seats, so
  --    the house order decides. 31 bookings since January got this wrong
  --    and each one dropped the largest seatable party from 26 to 18.
  -- ===================================================================
  r := pg_temp.pick(7, 'staff');
  ASSERT r = 'Low 4a + Low 4b', format('party 7 must take the Low pair, not the Dining Room pair; got %L', r);

  r := pg_temp.pick(8, 'staff');
  ASSERT r = 'Low 4a + Low 4b', format('party 8 must take the Low pair; got %L', r);

  -- ===================================================================
  -- 4. Minimum party size keeps small parties off the big tables.
  --    Big Bay and the three six-tops have a minimum of 4.
  -- ===================================================================
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'online', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND 'Big Bay' = ANY (c.table_names)
  ), 'a party of 2 must never be offered Big Bay while the minimum applies';

  -- ...but the minimum lapses close to the sitting, so a couple is not
  -- turned away on the night to protect a large party who is not coming.
  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'online', NULL, NULL,
      '2026-09-16 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND 'Big Bay' = ANY (c.table_names)
  ), 'within the release window a party of 2 should be able to have Big Bay';

  -- ===================================================================
  -- 5. THE CRITICAL FIX. A private booking over the Dining Room must not
  --    stop a couple booking the Main Bar. Before this, the allocator
  --    picked a blocked table and the whole booking failed with no_table.
  -- ===================================================================
  INSERT INTO public.test_private_blocks (table_id, starts_at, ends_at)
  SELECT id, '2026-09-16 17:00+01', '2026-09-16 23:00+01'
  FROM public.tables WHERE name LIKE 'Dining Room%';

  r := pg_temp.pick(2, 'staff');
  ASSERT r = 'High 4',
    format('with the Dining Room blocked by a function, a party of 2 must still get a Main Bar table; got %L', r);

  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.reason_code = 'table_private_block'
  ), 'blocked Dining Room tables must be reported as table_private_block, not silently dropped';

  -- A party of 7 with the Dining Room gone still has the Low pair.
  r := pg_temp.pick(7, 'staff');
  ASSERT r = 'Low 4a + Low 4b',
    format('party 7 with the Dining Room blocked should still get the Low pair; got %L', r);

  DELETE FROM public.test_private_blocks;

  -- ===================================================================
  -- 6. Accessibility. Small Bay has a step; High 4 is bar height.
  -- ===================================================================
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, true, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL
      AND ('Small Bay' = ANY (c.table_names) OR 'High 4' = ANY (c.table_names))
  ), 'an accessible-table request must exclude Small Bay (step) and High 4 (bar height)';

  r := pg_temp.pick(2, 'staff', true);
  ASSERT r = 'Low 4a', format('accessible party of 2 should get Low 4a, got %L', r);

  -- ===================================================================
  -- 7. High chairs. High 4 cannot take one. Today the system will happily
  --    confirm a family there and they arrive to find it unusable.
  -- ===================================================================
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 3, 'food', 1, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND 'High 4' = ANY (c.table_names)
  ), 'a booking with a high chair must never be offered High 4';

  -- ===================================================================
  -- 8. Occupancy, and the no-show fix. A cancelled or no-show booking
  --    must free its table; that is the walk-in complaint.
  -- ===================================================================
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, start_datetime, end_datetime)
  VALUES ('11111111-1111-1111-1111-111111111111','2026-09-16','18:00',2,'confirmed','2026-09-16 18:00+01','2026-09-16 20:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('11111111-1111-1111-1111-111111111111','8ff55f2a-86cb-4b2d-ae74-2d8cae44499b','2026-09-16 18:00+01','2026-09-16 20:15+01');

  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a',
    format('with Low 4b taken and Low 4a and High 4 held, an online party of 2 falls to Dining Room 4a; got %L', r);

  UPDATE public.table_bookings SET status = 'no_show' WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Low 4b', format('a no-show must free its table for the next booking; got %L', r);

  UPDATE public.table_bookings SET status = 'confirmed', left_at = '2026-09-16 19:00+01'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Low 4b', format('a booking whose guests have left must free its table; got %L', r);

  -- An expired unpaid hold releases; an expired PAID hold does not.
  UPDATE public.table_bookings
     SET status = 'pending_payment', left_at = NULL,
         hold_expires_at = '2026-09-01 09:00+01', payment_status = 'pending'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Low 4b', format('an expired unpaid hold must release its table; got %L', r);

  UPDATE public.table_bookings SET payment_status = 'completed'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a',
    format('an expired hold whose deposit is PAID must keep its table; got %L', r);

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  -- ===================================================================
  -- 9. Half-open windows. A booking ending at 20:00 does not block one
  --    starting at 20:00; the turnaround gap does that instead.
  -- ===================================================================
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, start_datetime, end_datetime)
  VALUES ('22222222-2222-2222-2222-222222222222','2026-09-16','16:00',2,'confirmed','2026-09-16 16:00+01','2026-09-16 18:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('22222222-2222-2222-2222-222222222222','8ff55f2a-86cb-4b2d-ae74-2d8cae44499b','2026-09-16 16:00+01','2026-09-16 18:00+01');

  r := pg_temp.pick(2);
  ASSERT r = 'Low 4b', format('a booking ending exactly at 18:00 must not block one starting at 18:00; got %L', r);

  UPDATE public.booking_table_assignments SET end_datetime = '2026-09-16 18:15+01';
  r := pg_temp.pick(2);
  ASSERT r = 'Dining Room 4a', format('with the 15 minute turnaround gap the table is still held; got %L', r);

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  -- ===================================================================
  -- 10. Big joins. The Dining Room reaches 26 seats.
  -- ===================================================================
  r := pg_temp.pick(20, 'staff');
  ASSERT r IS NOT NULL, 'a party of 20 must be seatable across the Dining Room';
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

  -- ...unless staff drop the adjacency requirement, which is the
  -- "in a live situation we would never turn that away" case.
  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01',27,'food',0,false,NULL,'staff',NULL,
      ROW(false,false,true,false)::public.table_allocation_overrides,
      '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1
  ), 'with allow_unjoined, staff must be able to seat a party of 27 across separated tables';

  -- ===================================================================
  -- 11. A staff-picked table is promoted, but only if it is valid.
  -- ===================================================================
  ASSERT (SELECT array_to_string(table_names,' + ') FROM public.find_table_allocation_candidates(
            '2026-09-16 18:00+01','2026-09-16 20:00+01',2,'food',0,false,
            ARRAY['39350c06-d5ea-4cea-a742-9ea78ebc0557'::uuid],'staff',NULL,NULL,
            '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1) = 'Dining Room 4a',
    'a table the staff explicitly picked must rank first';

  -- ===================================================================
  -- 12. Determinism. The same question must give the same answer.
  -- ===================================================================
  ASSERT pg_temp.pick(7,'staff') = pg_temp.pick(7,'staff'), 'ranking must be deterministic';

  RAISE NOTICE 'ALL ALLOCATION TESTS PASSED';
END;
$$;
