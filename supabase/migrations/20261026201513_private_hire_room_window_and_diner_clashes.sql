-- A private hire holds its room for one window everywhere, a whole-pub hire takes every table, and
-- staff can see the diners and event seats already in a hire's rooms (BK-159 and BK-070, customer
-- bookings review of 24 October 2026; owner decision D24).
--
-- Builds on 20261026175212_private_hire_occupies_space (release 3), which must be applied first:
-- the bodies replaced here are that migration's, and every function below calls
-- private_booking_occupies_space, which it creates.
--
-- 1. One occupied window (BK-159). Four places worked out when a hire holds its room, each its own
--    way: the table block ignored clear-down time and the "ends next day" flag, the garden block
--    ignored clear-down, the hire-against-hire clash check used an hour either side and the whole
--    day when no end time was set (and returned London wall-clock times labelled as UTC, an hour
--    out in summer), and the FOH screen recomputed it in TypeScript. private_booking_occupied_window
--    is now the rule: from the setup time (or the start) to the clear-down time (or the end, the
--    next day when the hire runs past midnight, or four hours after the start when no end is set),
--    with 30 minutes either side for the room to be turned round. The table block, the garden
--    block, the clash check and the new table block list all use it.
--
--    On 26 October 2026 no upcoming live hire has a setup or clear-down time, so no table or garden
--    block moves. Two hires booked against each other now need an hour between one ending and the
--    next starting, where before they needed two (or none at all when both had setup and clear-down
--    times), and a hire with no end time no longer blocks every other hire for the rest of its day.
--
-- 2. A whole-pub hire takes every table (BK-159). A space with blocks_all_spaces (Entire Pub) only
--    took the table areas hand-mapped to it, so a seating area added later stayed on sale during a
--    whole-pub hire. Today Entire Pub maps to both table areas, so no block changes.
--
-- 3. private_hire_table_blocks lists, for a period, every table each hire takes off sale and when.
--    is_table_blocked_by_private_booking_v05 is now that list for one table, and the FOH schedule
--    reads it instead of recomputing the window, so the screen and the booking engine agree.
--
-- 4. get_private_booking_diner_clashes lists the live table bookings, and the shared-seating event
--    seats, on tables in one hire's rooms inside its occupied window (BK-070). Owner decision D24:
--    staff are warned and shown the list, nothing is refused. It looks at any draft or confirmed
--    hire with a date, whether or not it holds its room yet, so staff see the clash before
--    confirming.
--
-- Function bodies replaced here are 20261026175212's text with only the window (and, for the table
-- block, the room match) changed. Headers, SECURITY DEFINER or INVOKER, search_path and grants are
-- restated as that migration leaves them. New functions are service_role only, except the window
-- rule, which the clash check (SECURITY INVOKER, run by staff sessions too) calls.
-- Rollback: tasks/private-hire-room-window/rollback.sql. Tested by
-- scripts/testing/private-hire-room-window-postgres.py.

CREATE OR REPLACE FUNCTION public.private_booking_occupied_window(
  p_event_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_end_time_next_day boolean,
  p_setup_date date,
  p_setup_time time without time zone,
  p_cleardown_time time without time zone
)
 RETURNS TABLE(occupied_from timestamp with time zone, occupied_until timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- London wall-clock times, read off the clock on the right date so a clock change is honoured.
  SELECT
    ((COALESCE(p_setup_date, p_event_date) + COALESCE(p_setup_time, p_start_time, time '00:00'))
       AT TIME ZONE 'Europe/London') - interval '30 minutes',
    CASE
      WHEN COALESCE(p_cleardown_time, p_end_time) IS NOT NULL THEN
        ((p_event_date
            + CASE
                WHEN COALESCE(p_end_time_next_day, false)
                  OR COALESCE(p_cleardown_time, p_end_time) <= COALESCE(p_start_time, time '00:00')
                  THEN 1
                ELSE 0
              END)
          + COALESCE(p_cleardown_time, p_end_time)) AT TIME ZONE 'Europe/London'
      WHEN p_start_time IS NOT NULL THEN
        ((p_event_date + p_start_time) AT TIME ZONE 'Europe/London') + interval '4 hours'
      -- No times at all: the whole day.
      ELSE ((p_event_date + 1) + time '00:00') AT TIME ZONE 'Europe/London'
    END + interval '30 minutes'
  WHERE p_event_date IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.private_booking_occupied_window(date, time without time zone, time without time zone, boolean, date, time without time zone, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.private_booking_occupied_window(date, time without time zone, time without time zone, boolean, date, time without time zone, time without time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.private_hire_table_blocks(
  p_window_start timestamp with time zone,
  p_window_end timestamp with time zone,
  p_exclude_private_booking_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(private_booking_id uuid, table_id uuid, blocked_from timestamp with time zone, blocked_until timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT pb.id, t.id, w.occupied_from, w.occupied_until
  FROM public.private_bookings pb
  CROSS JOIN LATERAL public.private_booking_occupied_window(
    pb.event_date, pb.start_time, pb.end_time, pb.end_time_next_day,
    pb.setup_date, pb.setup_time, pb.cleardown_time) w
  JOIN public.private_booking_items pbi
    ON pbi.booking_id = pb.id
   AND pbi.item_type = 'space'
   AND pbi.space_id IS NOT NULL
  JOIN public.venue_spaces vs ON vs.id = pbi.space_id
  JOIN public.tables t
    ON vs.blocks_all_spaces
    OR EXISTS (
      SELECT 1
      FROM public.venue_space_table_areas vsta
      WHERE vsta.venue_space_id = pbi.space_id
        AND vsta.table_area_id = t.area_id
    )
  WHERE p_window_start IS NOT NULL
    AND p_window_end IS NOT NULL
    AND p_window_end > p_window_start
    AND public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
    AND (p_exclude_private_booking_id IS NULL OR pb.id <> p_exclude_private_booking_id)
    -- Implied by the overlap test below (a window never runs past two days after the event, or
    -- starts more than a day before its setup date); here so the date index narrows the scan.
    AND pb.event_date >= (p_window_start AT TIME ZONE 'Europe/London')::date - 2
    AND COALESCE(pb.setup_date, pb.event_date) <= (p_window_end AT TIME ZONE 'Europe/London')::date + 1
    AND w.occupied_from < p_window_end
    AND w.occupied_until > p_window_start;
$function$;

REVOKE ALL ON FUNCTION public.private_hire_table_blocks(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_hire_table_blocks(timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_private_booking_conflicts(p_event_date date, p_start_time time without time zone, p_end_time time without time zone, p_setup_date date DEFAULT NULL::date, p_setup_time time without time zone DEFAULT NULL::time without time zone, p_cleardown_time time without time zone DEFAULT NULL::time without time zone, p_space_ids uuid[] DEFAULT '{}'::uuid[], p_exclude_booking_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_id uuid, customer_name text, booking_status text, space_name text, blocks_all boolean, occupies_from timestamp with time zone, occupies_until timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
WITH candidate_window AS (
  SELECT w.occupied_from AS win_start, w.occupied_until AS win_end
  FROM public.private_booking_occupied_window(
    p_event_date, p_start_time, p_end_time, NULL,
    p_setup_date, p_setup_time, p_cleardown_time) w
),
candidate_blocks_all AS (
  SELECT COALESCE(bool_or(vs.blocks_all_spaces), false) AS blocks_all
  FROM public.venue_spaces vs
  WHERE vs.id = ANY (p_space_ids)
),
other_bookings AS (
  SELECT
    pb.id,
    pb.customer_name,
    pb.status,
    w.occupied_from AS occ_start,
    w.occupied_until AS occ_end
  FROM public.private_bookings pb
  CROSS JOIN candidate_window cw
  CROSS JOIN LATERAL public.private_booking_occupied_window(
    pb.event_date, pb.start_time, pb.end_time, pb.end_time_next_day,
    pb.setup_date, pb.setup_time, pb.cleardown_time) w
  WHERE pb.event_date IS NOT NULL
    AND COALESCE(pb.date_tbd, false) = false
    AND (p_exclude_booking_id IS NULL OR pb.id <> p_exclude_booking_id)
    AND public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
    -- Narrowed by both occupied windows, setup days included, as private_hire_table_blocks does.
    -- A fixed span around the event date missed a hire set up days before its own date, or a
    -- candidate whose setup starts days early; the overlap test below does the real work.
    AND pb.event_date >= (cw.win_start AT TIME ZONE 'Europe/London')::date - 2
    AND COALESCE(pb.setup_date, pb.event_date) <= (cw.win_end AT TIME ZONE 'Europe/London')::date + 1
)
SELECT
  ob.id AS booking_id,
  ob.customer_name,
  ob.status AS booking_status,
  vs.name AS space_name,
  vs.blocks_all_spaces AS blocks_all,
  ob.occ_start AS occupies_from,
  ob.occ_until AS occupies_until
FROM (
  SELECT o.*, o.occ_end AS occ_until FROM other_bookings o
) ob
JOIN public.private_booking_items i
  ON i.booking_id = ob.id AND i.item_type = 'space' AND i.space_id IS NOT NULL
JOIN public.venue_spaces vs ON vs.id = i.space_id
CROSS JOIN candidate_window cw
CROSS JOIN candidate_blocks_all cba
WHERE ob.occ_start < cw.win_end
  AND ob.occ_until > cw.win_start
  AND (
    vs.blocks_all_spaces
    OR cba.blocks_all
    OR i.space_id = ANY (p_space_ids)
  )
GROUP BY ob.id, ob.customer_name, ob.status, vs.name, vs.blocks_all_spaces, ob.occ_start, ob.occ_until;
$function$;

REVOKE ALL ON FUNCTION public.get_private_booking_conflicts(date, time without time zone, time without time zone, date, time without time zone, time without time zone, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_private_booking_conflicts(date, time without time zone, time without time zone, date, time without time zone, time without time zone, uuid[], uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_table_blocked_by_private_booking_v05(p_table_id uuid, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_exclude_private_booking_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_table_id IS NULL
     OR p_window_start IS NULL
     OR p_window_end IS NULL
     OR p_window_end <= p_window_start THEN
    RETURN false;
  END IF;

  -- The same list the FOH schedule draws, for one table.
  RETURN EXISTS (
    SELECT 1
    FROM public.private_hire_table_blocks(p_window_start, p_window_end, p_exclude_private_booking_id) b
    WHERE b.table_id = p_table_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.outside_private_hire_windows(p_booking_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_id uuid, blocked_start timestamp with time zone, blocked_end timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT pb.id, w.occupied_from, w.occupied_until
  FROM public.private_bookings pb
  JOIN public.private_booking_items pi ON pi.booking_id = pb.id AND pi.item_type = 'space'
  JOIN public.venue_spaces vs ON vs.id = pi.space_id
  CROSS JOIN LATERAL public.private_booking_occupied_window(
    pb.event_date, pb.start_time, pb.end_time, pb.end_time_next_day,
    pb.setup_date, pb.setup_time, pb.cleardown_time) w
  WHERE public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
    AND (p_booking_id IS NULL OR pb.id = p_booking_id)
    AND (vs.id = '6869774b-cfa5-4aff-a663-a14b2fb5633b'::uuid OR vs.blocks_all_spaces);
$function$;

REVOKE ALL ON FUNCTION public.outside_private_hire_windows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outside_private_hire_windows(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_private_booking_diner_clashes(p_booking_id uuid)
 RETURNS TABLE(clash_kind text, table_booking_id uuid, event_booking_id uuid, event_id uuid, event_name text, booking_reference text, guest_name text, covers integer, starts_at timestamp with time zone, ends_at timestamp with time zone, table_names text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH hire AS (
    SELECT pb.id, w.occupied_from, w.occupied_until
    FROM public.private_bookings pb
    CROSS JOIN LATERAL public.private_booking_occupied_window(
      pb.event_date, pb.start_time, pb.end_time, pb.end_time_next_day,
      pb.setup_date, pb.setup_time, pb.cleardown_time) w
    WHERE pb.id = p_booking_id
      AND pb.status IN ('draft', 'confirmed')
      AND NOT COALESCE(pb.date_tbd, false)
  ),
  hire_tables AS (
    SELECT DISTINCT t.id AS table_id, COALESCE(NULLIF(btrim(t.name), ''), t.table_number::text) AS table_name
    FROM hire h
    JOIN public.private_booking_items pbi
      ON pbi.booking_id = h.id AND pbi.item_type = 'space' AND pbi.space_id IS NOT NULL
    JOIN public.venue_spaces vs ON vs.id = pbi.space_id
    JOIN public.tables t
      ON vs.blocks_all_spaces
      OR EXISTS (
        SELECT 1
        FROM public.venue_space_table_areas vsta
        WHERE vsta.venue_space_id = pbi.space_id
          AND vsta.table_area_id = t.area_id
      )
  )
  SELECT * FROM (
    SELECT
      'table_booking'::text,
      tb.id,
      NULL::uuid,
      tb.event_id,
      e.name::text,
      tb.booking_reference::text,
      NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
      COALESCE(tb.committed_party_size, tb.party_size),
      min(bta.start_datetime),
      max(bta.end_datetime),
      string_agg(DISTINCT ht.table_name, ', ' ORDER BY ht.table_name)
    FROM hire h
    JOIN public.booking_table_assignments bta
      ON bta.start_datetime < h.occupied_until
     AND bta.end_datetime > h.occupied_from
    JOIN hire_tables ht ON ht.table_id = bta.table_id
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    LEFT JOIN public.customers c ON c.id = tb.customer_id
    LEFT JOIN public.events e ON e.id = tb.event_id
    WHERE public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, now())
    GROUP BY tb.id, tb.event_id, e.name, tb.booking_reference, c.first_name, c.last_name,
      tb.committed_party_size, tb.party_size

    UNION ALL

    -- Shared-seating event places with no table booking of their own.
    SELECT
      'event_seats'::text,
      NULL::uuid,
      b.id,
      a.event_id,
      e.name::text,
      NULL::text,
      NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
      sum(a.seats)::integer,
      min(a.start_datetime),
      max(a.end_datetime),
      string_agg(DISTINCT ht.table_name, ', ' ORDER BY ht.table_name)
    FROM hire h
    JOIN public.event_communal_seat_allocations a
      ON a.start_datetime < h.occupied_until
     AND a.end_datetime > h.occupied_from
    JOIN hire_tables ht ON ht.table_id = a.table_id
    JOIN public.bookings b ON b.id = a.event_booking_id
    LEFT JOIN public.customers c ON c.id = b.customer_id
    LEFT JOIN public.events e ON e.id = a.event_id
    WHERE a.table_booking_id IS NULL
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
    GROUP BY b.id, a.event_id, e.name, c.first_name, c.last_name
  ) clashes(clash_kind, table_booking_id, event_booking_id, event_id, event_name, booking_reference,
            guest_name, covers, starts_at, ends_at, table_names)
  ORDER BY starts_at, booking_reference NULLS LAST, guest_name;
$function$;

REVOKE ALL ON FUNCTION public.get_private_booking_diner_clashes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_booking_diner_clashes(uuid) TO service_role;
