-- A whole-pub private hire stops event ticket sales for the event it overlaps (owner decision D24;
-- BK-071, customer bookings review of 24 October 2026).
--
-- Events have no room of their own, so nothing tied an event to a private hire: an Entire Pub hire
-- could be taken on an event night and tickets kept selling, and only table-mode events lost their
-- tables to it. Now:
--   * events_closed_by_whole_pub_hire(event ids) names, for each event, any hire of a whole-pub
--     space (venue_spaces.blocks_all_spaces) that holds its room (private_booking_occupies_space)
--     and whose occupied window (private_booking_occupied_window) overlaps the event. The event's
--     own window is worked out exactly as create_event_booking_v05 does it. The private booking
--     page passes its own hire as p_assume_holding to show which events it would close once it
--     holds its room; the booking function never passes it.
--   * create_event_booking_v05, which every booking path reaches (website, staff, FOH, waitlist
--     offers), refuses a new booking for such an event with the reason it already gives when
--     booking is closed, 'booking_closed', so every caller and the website already handle it and no
--     private detail reaches the guest. Bookings already taken are not touched: staff see them on
--     the hire's page and decide.
-- The events API also reports bookings_enabled false for such an event (app change in the same
-- release), so the website stops offering it; that needs no website change.
--
-- Depends on 20261026175212_private_hire_occupies_space and
-- 20261026201513_private_hire_room_window_and_diner_clashes, which must be applied first.
--
-- create_event_booking_v05 is patched in place, as 20261016180511_kitchen_pacing_lone_party patched
-- the pacing functions: the live definition is read with pg_get_functiondef, the booking_open check
-- (which appears exactly once; checked against production on 26 October 2026, md5(prosrc)
-- b902aaf91f8a4aad7f318bebd57c9463) has the new check added after it, and the result is executed.
-- The block refuses to run unless the anchor appears exactly once and the new check not at all, so
-- a definition that has moved on fails loudly instead of being half-patched; a second run is a
-- no-op. CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and search_path; the grants are
-- restated at the end anyway.
-- Rollback: tasks/whole-pub-hire-ticket-sales/rollback.sql. Tested by
-- scripts/testing/whole-pub-hire-ticket-sales-postgres.py.

CREATE OR REPLACE FUNCTION public.events_closed_by_whole_pub_hire(p_event_ids uuid[], p_assume_holding uuid DEFAULT NULL::uuid)
 RETURNS TABLE(event_id uuid, private_booking_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH starts AS (
    SELECT
      e.id,
      e.date,
      e.end_time,
      e.duration_minutes,
      COALESCE(
        e.start_datetime,
        CASE
          WHEN e.date IS NOT NULL AND e.time IS NOT NULL
            THEN ((e.date::text || ' ' || e.time::text)::timestamp AT TIME ZONE 'Europe/London')
          ELSE NULL
        END
      ) AS starts_at
    FROM public.events e
    WHERE e.id = ANY (p_event_ids)
  ),
  raw_windows AS (
    SELECT
      s.id,
      s.starts_at,
      COALESCE(
        CASE
          WHEN s.date IS NOT NULL AND s.end_time IS NOT NULL
            THEN ((s.date::text || ' ' || s.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
          ELSE NULL
        END,
        s.starts_at + make_interval(mins => GREATEST(COALESCE(s.duration_minutes, 180), 30))
      ) AS raw_end
    FROM starts s
    WHERE s.starts_at IS NOT NULL
  ),
  event_windows AS (
    SELECT
      r.id,
      r.starts_at,
      CASE WHEN r.raw_end <= r.starts_at THEN r.raw_end + INTERVAL '1 day' ELSE r.raw_end END AS ends_at
    FROM raw_windows r
  )
  SELECT DISTINCT ew.id, pb.id
  FROM event_windows ew
  -- Narrowed by the hire's whole occupied window, setup day included: a whole-pub hire set up
  -- two days before its date holds the pub from then, and the overlap test below decides.
  JOIN public.private_bookings pb
    ON pb.event_date >= (ew.starts_at AT TIME ZONE 'Europe/London')::date - 2
   AND COALESCE(pb.setup_date, pb.event_date) <= (ew.ends_at AT TIME ZONE 'Europe/London')::date + 1
  CROSS JOIN LATERAL public.private_booking_occupied_window(
    pb.event_date, pb.start_time, pb.end_time, pb.end_time_next_day,
    pb.setup_date, pb.setup_time, pb.cleardown_time) hw
  WHERE (
      public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
      OR (pb.id = p_assume_holding AND pb.status IN ('draft', 'confirmed') AND NOT COALESCE(pb.date_tbd, false))
    )
    AND EXISTS (
      SELECT 1
      FROM public.private_booking_items pbi
      JOIN public.venue_spaces vs ON vs.id = pbi.space_id
      WHERE pbi.booking_id = pb.id
        AND pbi.item_type = 'space'
        AND vs.blocks_all_spaces
    )
    AND hw.occupied_from < ew.ends_at
    AND hw.occupied_until > ew.starts_at;
$function$;

REVOKE ALL ON FUNCTION public.events_closed_by_whole_pub_hire(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.events_closed_by_whole_pub_hire(uuid[], uuid) TO service_role;

DO $patch$
DECLARE
  v_oid oid;
  v_count integer;
  v_def text;
  v_anchor constant text := E'  IF COALESCE(v_event.booking_open, true) = false THEN\n'
    || E'    RETURN jsonb_build_object(''state'', ''blocked'', ''reason'', ''booking_closed'');\n'
    || E'  END IF;\n';
  v_added constant text := E'\n'
    || E'  -- Owner decision D24 (customer bookings review, 24 October 2026): a whole-pub private hire\n'
    || E'  -- stops ticket sales for an event it overlaps. The guest is told booking has closed.\n'
    || E'  IF EXISTS (SELECT 1 FROM public.events_closed_by_whole_pub_hire(ARRAY[p_event_id])) THEN\n'
    || E'    RETURN jsonb_build_object(''state'', ''blocked'', ''reason'', ''booking_closed'');\n'
    || E'  END IF;\n';
  v_anchor_hits integer;
  v_added_hits integer;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_event_booking_v05';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'whole_pub_hire_stops_ticket_sales: expected one create_event_booking_v05, found %', v_count;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_anchor_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  v_added_hits := (length(v_def) - length(replace(v_def, v_added, ''))) / length(v_added);

  IF v_added_hits = 1 AND v_anchor_hits = 1 THEN
    RAISE NOTICE 'whole_pub_hire_stops_ticket_sales: create_event_booking_v05 already patched, skipped';
    RETURN;
  END IF;

  IF v_anchor_hits <> 1 OR v_added_hits <> 0 THEN
    RAISE EXCEPTION 'whole_pub_hire_stops_ticket_sales: create_event_booking_v05 has % booking_open checks and % hire checks, expected 1 and 0',
      v_anchor_hits, v_added_hits;
  END IF;

  EXECUTE replace(v_def, v_anchor, v_anchor || v_added);
  RAISE NOTICE 'whole_pub_hire_stops_ticket_sales: create_event_booking_v05 patched';
END
$patch$;

REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) TO service_role;
