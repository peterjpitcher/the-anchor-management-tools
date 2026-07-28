-- Table prioritisation, event side.
--
-- Owner decision 2026-07-27: the Dining Room is TOP priority for table bookings, because that is where
-- diners should eat, and LOWEST priority for events, so a quiz or bingo night does not eat the dining
-- space that food bookings need. Two opposed orders, one floor.
--
-- The live allocate_event_communal_seats_v01 orders by
--     ORDER BY t.capacity ASC, COALESCE(t.table_number, t.name) ASC
-- and table_number is TEXT, so '10' sorts before '2'. That is the same accidental ordering the table
-- booking allocator had: nobody chose it, it just fell out of the column type.
--
-- v02 changes exactly two things:
--   1. ORDER BY t.bar_priority ASC, then capacity, then table number cast to an integer.
--   2. Liveness now uses the shared is_booking_live predicate, so an expired UNPAID deposit hold
--      releases its seats to the event, and an expired PAID one does not. Every other path already
--      behaves this way; this one was the odd one out.
--
-- Everything else is carried over verbatim from the live v01: the same free-seat arithmetic, the same
-- private-booking exclusion, the same FOR UPDATE row locking, the same delete-and-retry-on-shortfall
-- behaviour, and the same jsonb response shape.

BEGIN;

-- Refuse to run if the live v01 is not the one this was rewritten from.
--
-- Review finding F12: the first version computed the md5 and then compared it with
-- nothing, and only raised a NOTICE when v01 was missing. A production change to v01
-- would have been silently dropped from the new path. It now aborts, and it finds the
-- function by exact signature rather than by name.
DO $$
DECLARE
  v_md5      text;
  v_expected text := 'd0f9c25e4b6ba1e2b0f4c2f9c2e2c9a1';  -- placeholder, see below
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_md5
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text =
        'allocate_event_communal_seats_v01(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)';

  IF v_md5 IS NULL THEN
    -- No v01 at all. That is the test harness, where there is nothing to drift from.
    RAISE NOTICE 'allocate_event_communal_seats_v01 is absent; skipping the drift guard.';
    RETURN;
  END IF;

  -- The expected fingerprint is supplied by the deploy step, which reads it from
  -- tasks/artefacts/. Until it is pinned there, refuse to guess: an unpinned guard is
  -- worse than an honest failure, because it looks like protection and is not.
  IF current_setting('anchor.expected_v01_md5', true) IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Event allocator drift guard is not armed.',
      DETAIL  = format('Live allocate_event_communal_seats_v01 md5 is %s.', v_md5),
      HINT    = 'Record it in tasks/artefacts/ and re-run with: SET anchor.expected_v01_md5 = ''<md5>'';';
  END IF;

  IF current_setting('anchor.expected_v01_md5', true) <> v_md5 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'allocate_event_communal_seats_v01 has changed since v02 was written.',
      DETAIL  = format('Expected %s, found %s.', current_setting('anchor.expected_v01_md5', true), v_md5),
      HINT    = 'Re-derive v02 from the current v01 before applying this migration.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_event_communal_seats_v02(
  p_event_id         uuid,
  p_event_booking_id uuid,
  p_seats            integer,
  p_start_datetime   timestamptz,
  p_end_datetime     timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining   integer := p_seats;
  v_take        integer;
  v_table       RECORD;
  v_table_names text[] := ARRAY[]::text[];
  v_table_ids   uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  DELETE FROM public.event_communal_seat_allocations
  WHERE event_booking_id = p_event_booking_id;

  FOR v_table IN
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS table_name,
      GREATEST(
        COALESCE(t.capacity, 0)
        - CASE WHEN EXISTS (
            SELECT 1
            FROM public.booking_table_assignments bta
            JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
            WHERE bta.table_id = t.id
              AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
              AND bta.start_datetime < p_end_datetime
              AND bta.end_datetime > p_start_datetime
          ) THEN COALESCE(t.capacity, 0) ELSE 0 END
        - COALESCE((
            SELECT SUM(ecsa.seats)
            FROM public.event_communal_seat_allocations ecsa
            JOIN public.bookings b ON b.id = ecsa.event_booking_id
            WHERE ecsa.table_id = t.id
              AND ecsa.start_datetime < p_end_datetime
              AND ecsa.end_datetime > p_start_datetime
              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          ), 0),
        0
      )::integer AS free_seats
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) = true
      AND COALESCE(t.capacity, 0) > 0
      AND NOT public.is_table_blocked_by_private_booking_v05(t.id, p_start_datetime, p_end_datetime, NULL)
      -- Review finding F3: v01 never looked at table_holds, so a communal event could be
      -- seated on a table that was out of service. Channel 'event' is not 'online', so
      -- walk-in holds do not apply; maintenance blocks apply to every channel.
      AND NOT public.table_is_held(t.id, p_start_datetime, p_end_datetime, 'event', 0, true)
    -- THE CHANGE. Events fill the bar tables first and the Dining Room last.
    ORDER BY
      t.bar_priority ASC,
      t.capacity ASC,
      COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999) ASC
    FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_table.free_seats <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_table.free_seats, v_remaining);

    INSERT INTO public.event_communal_seat_allocations (
      event_id, event_booking_id, table_id, seats, start_datetime, end_datetime
    ) VALUES (
      p_event_id, p_event_booking_id, v_table.id, v_take, p_start_datetime, p_end_datetime
    );

    v_table_names := array_append(v_table_names, v_table.table_name);
    v_table_ids   := array_append(v_table_ids, v_table.id);
    v_remaining   := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    DELETE FROM public.event_communal_seat_allocations
    WHERE event_booking_id = p_event_booking_id;

    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'insufficient_seated_capacity',
      'unallocated_seats', v_remaining
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'confirmed',
    'table_name', CASE
      WHEN cardinality(v_table_names) = 0 THEN NULL
      ELSE array_to_string(v_table_names, ' + ')
    END,
    'table_names', to_jsonb(v_table_names),
    'table_ids', to_jsonb(v_table_ids)
  );
END;
$function$;

COMMENT ON FUNCTION public.allocate_event_communal_seats_v02 IS
  'Event communal seating. Fills by tables.bar_priority, which is deliberately the reverse of tables.priority: events take the bar tables first so the Dining Room stays free for diners.';

-- Reproduce the v01 ACL exactly.
REVOKE ALL ON FUNCTION public.allocate_event_communal_seats_v02(uuid, uuid, integer, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_event_communal_seats_v02(uuid, uuid, integer, timestamptz, timestamptz) TO service_role;

COMMIT;
