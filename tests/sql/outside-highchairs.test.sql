-- Outside seating and high chairs, proved together.
--
-- Two things are under test and they are deliberately not the same thing:
--
--   The CHAIR is a physical object. There are two of them, they can be carried into the garden,
--   and a booking inside and a booking outside draw on the same two. Asking for one never
--   refuses a booking; it grants what is left and reports the shortfall.
--
--   The SEAT the chair stands next to is the outside table. Before 20260801001400 only the
--   booking RPC ever recorded one, so a walk-in taken outside held nothing, and a booking moved
--   or resized went on holding the wrong thing.

\set ON_ERROR_STOP on

DO $$
DECLARE
  r          jsonb;
  v_cust     uuid := gen_random_uuid();
  v_id       uuid;
  v_other    uuid;
  -- Pinned to a Wednesday, and far enough out that the in_past check can never reach it.
  -- Sunday carries a turn-time uplift, so a floating date would make the window maths drift.
  v_date     date := (CURRENT_DATE + 60) + ((3 - EXTRACT(DOW FROM CURRENT_DATE + 60)::int + 7) % 7);
  v_start    timestamptz;
  v_end      timestamptz;
  v_res      record;
BEGIN
  -- Own every setting this suite asserts on. The suites share one database and the settings
  -- suite deliberately leaves values behind.
  UPDATE public.system_settings SET value = '{"value": true}' WHERE key = 'table_allocation_v06_enabled';
  UPDATE public.system_settings SET value = '{"value": true}' WHERE key = 'turn_times_enabled';
  UPDATE public.system_settings SET value = '{"value": 90}'   WHERE key = 'turn_time_minutes_1_2';
  UPDATE public.system_settings SET value = '{"value": 105}'  WHERE key = 'turn_time_minutes_3_4';
  UPDATE public.system_settings SET value = '{"value": 120}'  WHERE key = 'turn_time_minutes_5_6';
  UPDATE public.system_settings SET value = '{"value": 150}'  WHERE key = 'turn_time_minutes_7_plus';
  UPDATE public.system_settings SET value = '{"value": 15}'   WHERE key = 'turnaround_gap_minutes';
  UPDATE public.system_settings SET value = '{"value": 5}'    WHERE key = 'outside_table_count';
  UPDATE public.system_settings SET value = '{"value": 8}'    WHERE key = 'outside_table_capacity';

  INSERT INTO public.system_settings (key, value) VALUES ('high_chair_inventory', '{"value": 2}')
    ON CONFLICT (key) DO UPDATE SET value = '{"value": 2}';

  ASSERT EXTRACT(DOW FROM v_date)::int = 3, 'the test date must be a Wednesday';

  -- ===================================================================
  -- CHAIRS OUTSIDE, with both free.
  --
  -- Drinks throughout, so the kitchen pacing ceiling can never be what answers.
  -- ===================================================================
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '14:00', 2, 'drinks', NULL, false, 'brand_site',
         false, false, false, 2, true, false);
  ASSERT r ->> 'state' = 'confirmed', format('an outside booking with chairs must confirm; got %s', r);
  ASSERT (r ->> 'is_outside_seating')::boolean = true, 'the booking must be recorded as outside';
  ASSERT (r ->> 'high_chairs_granted')::int = 2,
    format('both chairs are free, so both must be granted outside; got %s', r ->> 'high_chairs_granted');
  ASSERT (r ->> 'high_chairs_short')::int = 0, 'nothing should be short when both were free';

  v_id := (r ->> 'table_booking_id')::uuid;

  -- The chair is granted against the SAME row an inside booking would use. There is one pool.
  ASSERT (SELECT high_chair_count FROM public.table_bookings WHERE id = v_id) = 2,
    'the granted count must be persisted on the booking, outside included';

  -- And an outside booking holds a real outside table, not nothing.
  SELECT * INTO v_res FROM public.outside_reservations WHERE table_booking_id = v_id;
  ASSERT FOUND, 'an outside booking must hold an outside table';
  ASSERT v_res.tables_reserved = 1, format('a party of 2 needs one outside table; got %s', v_res.tables_reserved);
  ASSERT v_res.capacity_basis = 8, 'the basis in force must be stored on the row';
  ASSERT v_res.ends_at - v_res.starts_at = interval '105 minutes',
    format('90 minutes for a two-top plus the 15 minute gap; got %s', v_res.ends_at - v_res.starts_at);

  -- ===================================================================
  -- CHAIRS OUTSIDE, with one left.
  -- ===================================================================
  UPDATE public.table_bookings SET high_chair_count = 1 WHERE id = v_id;

  r := public.create_table_booking_public_v06(
         v_cust, v_date, '14:00', 2, 'drinks', NULL, false, 'brand_site',
         false, false, false, 2, true, false);
  ASSERT r ->> 'state' = 'confirmed', 'a chair shortage must never refuse an outside booking';
  ASSERT (r ->> 'high_chairs_granted')::int = 1,
    format('one chair is left, so one is granted; got %s', r ->> 'high_chairs_granted');
  ASSERT (r ->> 'high_chairs_short')::int = 1,
    'the shortfall must be reported, so the family is not surprised on arrival';

  -- ===================================================================
  -- CHAIRS OUTSIDE, with none left. Still never blocks.
  -- ===================================================================
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '14:00', 2, 'drinks', NULL, false, 'brand_site',
         false, false, false, 1, true, false);
  ASSERT r ->> 'state' = 'confirmed', 'no chairs left must still take the booking';
  ASSERT (r ->> 'high_chairs_granted')::int = 0,
    format('nothing is left to grant; got %s', r ->> 'high_chairs_granted');
  ASSERT (r ->> 'high_chairs_short')::int = 1, 'the whole request must be reported short';

  -- ===================================================================
  -- INSIDE AND OUTSIDE COMPETE FOR THE SAME LAST CHAIR.
  --
  -- The chairs are physical objects. They cannot be in the garden and the dining room at once,
  -- so an outside booking holding one must be visible to an inside booking asking for one, and
  -- the other way round.
  -- ===================================================================
  -- Clear the field at a fresh time, then take one chair OUTSIDE.
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '17:00', 2, 'drinks', NULL, false, 'brand_site',
         false, false, false, 1, true, false);
  ASSERT (r ->> 'high_chairs_granted')::int = 1, 'the outside booking should take one chair';
  v_other := (r ->> 'table_booking_id')::uuid;

  -- ...and take the other INSIDE, at the same time.
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '17:00', 2, 'drinks', NULL, false, 'brand_site',
         false, false, false, 2, false, false);
  ASSERT r ->> 'state' = 'confirmed', 'the inside booking should still confirm';
  ASSERT (r ->> 'high_chairs_granted')::int = 1,
    format('the outside booking holds one of the two, so inside can only have one; got %s',
           r ->> 'high_chairs_granted');
  ASSERT (r ->> 'high_chairs_short')::int = 1, 'the second chair is outside, so it is short';

  -- Now the reverse: both are held, one inside and one outside, and a third asks.
  r := public.create_table_booking_public_v06(
         v_cust, v_date, '17:00', 2, 'drinks', NULL, false, 'brand_site',
         false, false, false, 2, true, false);
  ASSERT r ->> 'state' = 'confirmed', 'the third booking must not be refused over chairs';
  ASSERT (r ->> 'high_chairs_granted')::int = 0,
    format('both chairs are out, one in and one outside; got %s', r ->> 'high_chairs_granted');

  -- The JS override paths grant through reserve_high_chairs rather than the RPC. It must
  -- reach the same answer against the same pool.
  ASSERT public.reserve_high_chairs(v_other, 2, (v_date + time '17:00') AT TIME ZONE 'Europe/London',
                                    ((v_date + time '17:00') AT TIME ZONE 'Europe/London') + interval '90 minutes') = 1,
    'reserve_high_chairs must see the inside booking''s chair and grant only the one it already holds';

  -- ===================================================================
  -- CHAIRS ARE ADVISORY IN AVAILABILITY, AND OUTSIDE IS NOT A BLIND SPOT.
  -- ===================================================================
  r := public.check_table_availability_v06(v_date, 2, 'drinks', true, false, 2, 'online');
  ASSERT r ->> 'calculation_state' = 'complete', format('availability must compute; got %s', r);
  ASSERT (r -> 'outside')::text = 'true', 'the answer must say it is an outside answer';
  ASSERT (SELECT bool_and(s ? 'high_chairs_remaining') FROM jsonb_array_elements(r -> 'slots') s),
    'every outside slot must carry the chairs left, not just the inside ones';
  ASSERT (SELECT (s ->> 'high_chairs_remaining')::int = 0
            FROM jsonb_array_elements(r -> 'slots') s
           WHERE s ->> 'time' = '17:00'),
    'the 17:00 slot has both chairs out, so it must report none left';
  ASSERT (SELECT s ->> 'state' FROM jsonb_array_elements(r -> 'slots') s WHERE s ->> 'time' = '17:00')
           = 'available',
    'chairs must never make a slot unavailable';

  RAISE NOTICE 'ALL OUTSIDE HIGH CHAIR TESTS PASSED';
END;
$$;

-- =====================================================================
-- The seat, not the chair: the reservation row must follow the booking.
-- =====================================================================
DO $$
DECLARE
  r        jsonb;
  v_cust   uuid := gen_random_uuid();
  v_id     uuid;
  v_res    record;
  v_date   date := (CURRENT_DATE + 90) + ((3 - EXTRACT(DOW FROM CURRENT_DATE + 90)::int + 7) % 7);
BEGIN
  -- ===================================================================
  -- A RAW INSERT that never touches the RPC. This is the FOH walk-in override path, and
  -- before the reconciler it held nothing at all.
  -- ===================================================================
  INSERT INTO public.table_bookings
    (customer_id, booking_reference, booking_date, booking_time, party_size, status,
     booking_purpose, is_outside_seating, start_datetime, end_datetime, duration_minutes)
  VALUES
    (v_cust, 'TB-WALKIN1', v_date, '15:00', 4, 'confirmed', 'drinks', true,
     (v_date + time '15:00') AT TIME ZONE 'Europe/London',
     ((v_date + time '15:00') AT TIME ZONE 'Europe/London') + interval '90 minutes', 90)
  RETURNING id INTO v_id;

  ASSERT NOT EXISTS (SELECT 1 FROM public.outside_reservations WHERE table_booking_id = v_id),
    'the trigger is UPDATE only on purpose, so a bare insert still holds nothing yet';

  PERFORM public.sync_outside_reservation(v_id);

  SELECT * INTO v_res FROM public.outside_reservations WHERE table_booking_id = v_id;
  ASSERT FOUND, 'an outside walk-in must hold an outside table once reconciled';
  ASSERT v_res.tables_reserved = 1, 'a party of 4 fits on one outside table';
  ASSERT v_res.starts_at = (SELECT start_datetime FROM public.table_bookings WHERE id = v_id),
    'the hold must start when the booking starts';

  -- Idempotent. Running it again changes nothing and raises nothing.
  PERFORM public.sync_outside_reservation(v_id);
  ASSERT (SELECT count(*) FROM public.outside_reservations WHERE table_booking_id = v_id) = 1,
    'reconciling twice must not create a second hold';

  -- ===================================================================
  -- A RE-WINDOW. This is the BOH edit and move_table_booking_time paths.
  -- ===================================================================
  UPDATE public.table_bookings
     SET booking_time    = '19:00',
         start_datetime  = (v_date + time '19:00') AT TIME ZONE 'Europe/London',
         end_datetime    = ((v_date + time '19:00') AT TIME ZONE 'Europe/London') + interval '90 minutes'
   WHERE id = v_id;

  SELECT * INTO v_res FROM public.outside_reservations WHERE table_booking_id = v_id;
  ASSERT v_res.starts_at = (v_date + time '19:00') AT TIME ZONE 'Europe/London',
    format('the outside hold must move with the booking; got %s', v_res.starts_at);
  ASSERT v_res.ends_at = ((v_date + time '19:00') AT TIME ZONE 'Europe/London')
                         + interval '105 minutes',
    'the moved hold must keep the turnaround gap';

  -- ===================================================================
  -- A PARTY-SIZE CHANGE. This is the guest amend path. Eight fits on one table, sixteen does not.
  -- ===================================================================
  UPDATE public.table_bookings SET party_size = 16 WHERE id = v_id;
  ASSERT (SELECT tables_reserved FROM public.outside_reservations WHERE table_booking_id = v_id) = 2,
    'growing to sixteen must take a second outside table';

  UPDATE public.table_bookings SET party_size = 4 WHERE id = v_id;
  ASSERT (SELECT tables_reserved FROM public.outside_reservations WHERE table_booking_id = v_id) = 1,
    'shrinking back must give the second table up again';

  -- The basis is NOT re-read from settings. A booking keeps the capacity it was promised under.
  UPDATE public.system_settings SET value = '{"value": 4}' WHERE key = 'outside_table_capacity';
  UPDATE public.table_bookings SET party_size = 8 WHERE id = v_id;
  ASSERT (SELECT capacity_basis FROM public.outside_reservations WHERE table_booking_id = v_id) = 8,
    'a later capacity change must not re-cost a booking that was already promised';
  ASSERT (SELECT tables_reserved FROM public.outside_reservations WHERE table_booking_id = v_id) = 1,
    'eight on the promised basis of eight is still one table';
  UPDATE public.system_settings SET value = '{"value": 8}' WHERE key = 'outside_table_capacity';

  -- ===================================================================
  -- MOVED INDOORS. An inside booking must not go on holding a garden table.
  -- ===================================================================
  UPDATE public.table_bookings SET is_outside_seating = false WHERE id = v_id;
  ASSERT NOT EXISTS (SELECT 1 FROM public.outside_reservations WHERE table_booking_id = v_id),
    'a booking moved indoors must release its outside table';

  UPDATE public.table_bookings SET is_outside_seating = true WHERE id = v_id;
  ASSERT EXISTS (SELECT 1 FROM public.outside_reservations WHERE table_booking_id = v_id),
    'and moving it back out must take one again';

  -- ===================================================================
  -- IT NEVER BLOCKS. The garden being full is not a reason to refuse a staff edit; it is a
  -- reason for the next customer to be told the truth.
  -- ===================================================================
  FOR i IN 1..5 LOOP
    r := public.create_table_booking_public_v06(
           gen_random_uuid(), v_date, '19:00', 8, 'drinks', NULL, false, 'brand_site',
           false, false, false, 0, true, false);
  END LOOP;

  -- The garden is now oversubscribed by the edit above plus five more, and the edit still lands.
  UPDATE public.table_bookings SET party_size = 16 WHERE id = v_id;
  ASSERT (SELECT tables_reserved FROM public.outside_reservations WHERE table_booking_id = v_id) = 2,
    'a re-cost into a full garden must be recorded, not refused';

  -- ...and the next customer is now told no, which is the whole point.
  r := public.create_table_booking_public_v06(
         gen_random_uuid(), v_date, '19:00', 4, 'drinks', NULL, false, 'brand_site',
         false, false, false, 0, true, false);
  ASSERT r ->> 'reason' = 'outside_full',
    format('with the garden over capacity the next booking must be refused; got %s', r);

  RAISE NOTICE 'ALL OUTSIDE RESERVATION TESTS PASSED';
END;
$$;
