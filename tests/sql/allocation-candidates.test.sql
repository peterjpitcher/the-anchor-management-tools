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

  -- ===================================================================
  -- F2. A maintenance block must bite across the WHOLE booking window,
  --     not just at its start time.
  -- ===================================================================
  INSERT INTO public.table_holds (scope, table_id, hold_type, status, starts_on, ends_on, starts_at, ends_at, note)
  VALUES ('table','8ff55f2a-86cb-4b2d-ae74-2d8cae44499b','maintenance','active',
          '2026-09-16','2026-09-16','19:00','21:00','broken chair');

  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.reason_code = 'table_blocked' AND 'Low 4b' = ANY (c.table_names)
  ), 'a maintenance block starting mid-booking must still block the table';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND 'Low 4b' = ANY (c.table_names)
  ), 'a table under maintenance must never be offered';

  DELETE FROM public.table_holds WHERE hold_type = 'maintenance';

  -- ===================================================================
  -- F4. A walk-in hold withholds a table from ONLINE SINGLE sale, but must
  --     NOT remove it from joined combinations. Low 4a is held.
  -- ===================================================================
  INSERT INTO public.test_private_blocks (table_id, starts_at, ends_at)
  SELECT id, '2026-09-16 17:00+01', '2026-09-16 23:00+01'
  FROM public.tables WHERE name LIKE 'Dining Room%';

  r := pg_temp.pick(7);
  ASSERT r = 'Low 4a + Low 4b',
    format('an online party of 7 must still be offered the held Low pair as a JOIN; got %L', r);

  -- ...while a lone couple still cannot take the held table online.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'online', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL AND c.table_count = 1 AND 'Low 4a' = ANY (c.table_names)
  ), 'a walk-in-held table must not be sold online as a single';

  DELETE FROM public.test_private_blocks;

  -- ===================================================================
  -- F6. Connectivity is tested on the finished set, not enforced during
  --     growth. Big Bay and Small Bay join nothing, so they are not a run.
  -- ===================================================================
  ASSERT public.tables_are_connected(ARRAY[
    'ea61faf9-ebfc-4964-bd60-ef907af36848'::uuid,'8ff55f2a-86cb-4b2d-ae74-2d8cae44499b'::uuid]),
    'the Low pair is joined and must read as connected';

  ASSERT NOT public.tables_are_connected(ARRAY[
    'd0b22c8d-ac37-41b3-9c8b-45eb174f29c6'::uuid,'37d61f34-0eed-4a97-9e8c-aa868fdfe779'::uuid]),
    'Big Bay and Small Bay join nothing and must not read as connected';

  -- A bridge topology: 4a joins 6c, 4b joins 6c, but 4a does not join 4b directly...
  ASSERT public.tables_are_connected(ARRAY[
    '39350c06-d5ea-4cea-a742-9ea78ebc0557'::uuid,   -- DR 4a
    'f16044f7-8dcf-4403-8e89-02992fdc9532'::uuid,   -- DR 4b
    'fc306a12-0cb2-4692-bf3f-cfb89466abb6'::uuid]), -- DR 6c bridges them
    'a set connected only through a third table must read as connected';

  -- A disconnected pair must never be offered as a join.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 11, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.rank IS NOT NULL
      AND 'Big Bay' = ANY (c.table_names) AND 'Small Bay' = ANY (c.table_names)
  ), 'Big Bay plus Small Bay is not a physical run and must not be offered';

  -- ===================================================================
  -- F5. No eight-table cap.
  --
  -- The floor is 49 seats across 10 tables, so eight tables can reach 40 on an
  -- empty room. Occupy one six-top and the remaining nine hold 43, of which any
  -- eight hold at most 39. A staff party of 40 then REQUIRES all nine, which the
  -- old hard cap of eight made impossible.
  -- ===================================================================
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, start_datetime, end_datetime)
  VALUES ('33333333-3333-3333-3333-333333333333','2026-09-16','18:00',6,'confirmed','2026-09-16 18:00+01','2026-09-16 20:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('33333333-3333-3333-3333-333333333333','5deb3b97-1f18-4ee7-97c9-887b47ff504e','2026-09-16 18:00+01','2026-09-16 20:15+01');

  ASSERT (SELECT table_count FROM public.find_table_allocation_candidates(
            '2026-09-16 18:00+01','2026-09-16 20:00+01', 40, 'food', 0, false, NULL, 'staff', NULL,
            ROW(false,false,true,false)::public.table_allocation_overrides,
            '2026-09-01 12:00+01'::timestamptz) WHERE rank = 1) = 9,
    'with one six-top occupied, a staff party of 40 needs all nine remaining tables';

  DELETE FROM public.booking_table_assignments;
  DELETE FROM public.table_bookings;

  -- ===================================================================
  -- F7. A cancelled event booking must not hold a table hostage.
  -- ===================================================================
  INSERT INTO public.bookings (id, status) VALUES
    ('66666666-6666-6666-6666-666666666666','cancelled'),
    ('77777777-7777-7777-7777-777777777777','confirmed');

  INSERT INTO public.event_communal_seat_allocations (event_booking_id, table_id, seats, start_datetime, end_datetime)
  VALUES ('66666666-6666-6666-6666-666666666666','39350c06-d5ea-4cea-a742-9ea78ebc0557',4,
          '2026-09-16 17:00+01','2026-09-16 23:00+01');

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.reason_code = 'table_communal' AND 'Dining Room 4a' = ANY (c.table_names)
  ), 'a CANCELLED event booking must not block a table';

  -- ...but a confirmed one still does.
  INSERT INTO public.event_communal_seat_allocations (event_booking_id, table_id, seats, start_datetime, end_datetime)
  VALUES ('77777777-7777-7777-7777-777777777777','f16044f7-8dcf-4403-8e89-02992fdc9532',4,
          '2026-09-16 17:00+01','2026-09-16 23:00+01');

  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 2, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.reason_code = 'table_communal' AND 'Dining Room 4b' = ANY (c.table_names)
  ), 'a CONFIRMED event booking must still block its table';

  DELETE FROM public.event_communal_seat_allocations;
  DELETE FROM public.bookings;

  -- ===================================================================
  -- F10. An exact staff-selected COMBINATION must win, not just a single.
  -- ===================================================================
  ASSERT (SELECT array_to_string(table_names,' + ')
          FROM public.find_table_allocation_candidates(
            '2026-09-16 18:00+01','2026-09-16 20:00+01', 7, 'food', 0, false,
            ARRAY['ea61faf9-ebfc-4964-bd60-ef907af36848'::uuid,
                  '8ff55f2a-86cb-4b2d-ae74-2d8cae44499b'::uuid],
            'staff', NULL, NULL, '2026-09-01 12:00+01'::timestamptz)
          WHERE rank = 1) = 'Low 4a + Low 4b',
    'a staff-selected pair must rank first, not be silently replaced';

  -- ===================================================================
  -- F14. A table too small for the party is REPORTED, not silently dropped.
  -- ===================================================================
  ASSERT EXISTS (
    SELECT 1 FROM public.find_table_allocation_candidates(
      '2026-09-16 18:00+01','2026-09-16 20:00+01', 6, 'food', 0, false, NULL, 'staff', NULL, NULL,
      '2026-09-01 12:00+01'::timestamptz) c
    WHERE c.reason_code = 'too_large_for_table' AND 'High 4' = ANY (c.table_names)
  ), 'a table too small for the party must return a reason row, not vanish';

  -- ===================================================================
  -- F8. Selection and enforcement must agree. The real production trigger is
  --     attached in this harness, so a disagreement shows up as a raised
  --     exception rather than passing silently.
  --
  --     An expired UNPAID deposit hold is released by the picker. Before this
  --     fix the trigger still counted it as live, so the picker offered a table
  --     the insert then refused with 23P01, and the booking failed outright.
  -- ===================================================================
  INSERT INTO public.table_bookings
    (id, booking_date, booking_time, party_size, status, payment_status, hold_expires_at, start_datetime, end_datetime)
  VALUES ('44444444-4444-4444-4444-444444444444','2026-09-16','18:00',2,
          'pending_payment','pending','2026-01-01 09:00+00',
          '2026-09-16 18:00+01','2026-09-16 20:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('44444444-4444-4444-4444-444444444444','39350c06-d5ea-4cea-a742-9ea78ebc0557',
          '2026-09-16 18:00+01','2026-09-16 20:15+01');

  -- The picker says Dining Room 4a is free, because the hold expired unpaid.
  r := pg_temp.pick(2, 'staff');
  ASSERT r = 'Dining Room 4a',
    format('the picker should release a table held by an expired unpaid hold; got %L', r);

  -- ...and the trigger must agree, so the insert actually succeeds.
  INSERT INTO public.table_bookings (id, booking_date, booking_time, party_size, status, start_datetime, end_datetime)
  VALUES ('55555555-4444-4444-4444-444444444444','2026-09-16','18:00',2,'confirmed',
          '2026-09-16 18:00+01','2026-09-16 20:00+01');
  INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
  VALUES ('55555555-4444-4444-4444-444444444444','39350c06-d5ea-4cea-a742-9ea78ebc0557',
          '2026-09-16 18:00+01','2026-09-16 20:15+01');

  -- And the converse: once that deposit is PAID, both must hold the table.
  UPDATE public.table_bookings SET payment_status = 'completed'
   WHERE id = '44444444-4444-4444-4444-444444444444';
  DELETE FROM public.booking_table_assignments
   WHERE table_booking_id = '55555555-4444-4444-4444-444444444444';

  ASSERT pg_temp.pick(2, 'staff') <> 'Dining Room 4a',
    'an expired but PAID hold must keep its table in the picker';

  BEGIN
    INSERT INTO public.booking_table_assignments (table_booking_id, table_id, start_datetime, end_datetime)
    VALUES ('55555555-4444-4444-4444-444444444444','39350c06-d5ea-4cea-a742-9ea78ebc0557',
            '2026-09-16 18:00+01','2026-09-16 20:15+01');
    ASSERT false, 'the trigger must refuse a table held by an expired but PAID hold';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;  -- expected
  END;

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

  -- ===================================================================
  -- F3. The event allocator must respect maintenance blocks. v01 never looked
  --     at table_holds at all, so a quiz night could be seated on a table that
  --     was out of service.
  -- ===================================================================
  INSERT INTO public.table_holds (scope, table_id, hold_type, status, starts_on, ends_on, starts_at, ends_at, note)
  VALUES ('table','ea61faf9-ebfc-4964-bd60-ef907af36848','maintenance','active',
          '2026-09-16','2026-09-16','17:00','23:00','out of service');

  INSERT INTO public.bookings (id, status) VALUES
    ('88888888-8888-8888-8888-888888888888', 'confirmed');

  v_result := public.allocate_event_communal_seats_v02(
                gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 4,
                '2026-09-16 19:00+01', '2026-09-16 21:00+01');

  ASSERT v_result ->> 'state' = 'confirmed',
    format('the event should still seat somewhere, got %s', v_result);
  ASSERT (v_result ->> 'table_name') NOT LIKE '%Low 4a%',
    format('an event must not be seated on a table under maintenance; got %s', v_result ->> 'table_name');

  DELETE FROM public.table_holds WHERE hold_type = 'maintenance';
  DELETE FROM public.event_communal_seat_allocations;

  RAISE NOTICE 'ALL EVENT ALLOCATION TESTS PASSED';
END;
$$;
