-- Rollback for 20261026201513_private_hire_room_window_and_diner_clashes.sql: restores the clash check,
-- the table block and the garden block exactly as 20261026175212_private_hire_occupies_space left them
-- (the state this migration replaced), then drops the four functions it added.

CREATE OR REPLACE FUNCTION public.get_private_booking_conflicts(p_event_date date, p_start_time time without time zone, p_end_time time without time zone, p_setup_date date DEFAULT NULL::date, p_setup_time time without time zone DEFAULT NULL::time without time zone, p_cleardown_time time without time zone DEFAULT NULL::time without time zone, p_space_ids uuid[] DEFAULT '{}'::uuid[], p_exclude_booking_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_id uuid, customer_name text, booking_status text, space_name text, blocks_all boolean, occupies_from timestamp with time zone, occupies_until timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
WITH candidate_window AS (
  SELECT
    COALESCE(p_setup_date, p_event_date)::timestamp
      + CASE
          WHEN p_setup_time IS NOT NULL THEN p_setup_time::interval
          WHEN p_start_time IS NOT NULL THEN p_start_time::interval - INTERVAL '1 hour'
          ELSE INTERVAL '0'
        END AS win_start,
    p_event_date::timestamp
      + CASE
          WHEN p_cleardown_time IS NOT NULL THEN p_cleardown_time::interval
          WHEN p_end_time IS NOT NULL THEN p_end_time::interval + INTERVAL '1 hour'
          ELSE INTERVAL '23 hours 59 minutes'
        END
      + CASE
          WHEN p_end_time IS NOT NULL AND p_start_time IS NOT NULL AND p_end_time <= p_start_time
            THEN INTERVAL '1 day'
          ELSE INTERVAL '0'
        END AS win_end
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
    COALESCE(pb.setup_date, pb.event_date)::timestamp
      + CASE
          WHEN pb.setup_time IS NOT NULL THEN pb.setup_time::interval
          WHEN pb.start_time IS NOT NULL THEN pb.start_time::interval - INTERVAL '1 hour'
          ELSE INTERVAL '0'
        END AS occ_start,
    pb.event_date::timestamp
      + CASE
          WHEN pb.cleardown_time IS NOT NULL THEN pb.cleardown_time::interval
          WHEN pb.end_time IS NOT NULL THEN pb.end_time::interval + INTERVAL '1 hour'
          ELSE INTERVAL '23 hours 59 minutes'
        END
      + CASE
          WHEN pb.end_time IS NOT NULL AND pb.start_time IS NOT NULL
               AND (pb.end_time_next_day OR pb.end_time <= pb.start_time)
            THEN INTERVAL '1 day'
          ELSE INTERVAL '0'
        END AS occ_end
  FROM public.private_bookings pb
  WHERE pb.event_date IS NOT NULL
    AND COALESCE(pb.date_tbd, false) = false
    AND (p_exclude_booking_id IS NULL OR pb.id <> p_exclude_booking_id)
    AND public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
    AND pb.event_date BETWEEN p_event_date - 1 AND p_event_date + 1
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
DECLARE
  v_is_blocked boolean := false;
BEGIN
  IF p_table_id IS NULL
     OR p_window_start IS NULL
     OR p_window_end IS NULL
     OR p_window_end <= p_window_start THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.tables t
    JOIN public.venue_space_table_areas vsta
      ON vsta.table_area_id = t.area_id
    JOIN public.private_booking_items pbi
      ON pbi.space_id = vsta.venue_space_id
    JOIN public.private_bookings pb
      ON pb.id = pbi.booking_id
    CROSS JOIN LATERAL (
      SELECT
        ((COALESCE(pb.setup_date, pb.event_date)::text || ' ' || COALESCE(pb.setup_time, pb.start_time)::text)::timestamp AT TIME ZONE 'Europe/London') AS window_start,
        CASE
          WHEN pb.end_time IS NOT NULL
            THEN ((pb.event_date::text || ' ' || pb.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
          ELSE (((pb.event_date::text || ' ' || pb.start_time::text)::timestamp AT TIME ZONE 'Europe/London') + INTERVAL '4 hours')
        END AS window_end_raw
    ) booking_window
    CROSS JOIN LATERAL (
      SELECT
        booking_window.window_start AS window_start,
        CASE
          WHEN booking_window.window_end_raw <= booking_window.window_start
            THEN booking_window.window_end_raw + INTERVAL '1 day'
          ELSE booking_window.window_end_raw
        END AS window_end
    ) normalized_window
    CROSS JOIN LATERAL (
      SELECT
        normalized_window.window_start - INTERVAL '30 minutes' AS blocked_start,
        normalized_window.window_end + INTERVAL '30 minutes' AS blocked_end
    ) buffered_window
    WHERE t.id = p_table_id
      AND t.area_id IS NOT NULL
      AND pbi.item_type = 'space'
      AND pbi.space_id IS NOT NULL
      AND public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
      AND (p_exclude_private_booking_id IS NULL OR pb.id <> p_exclude_private_booking_id)
      AND buffered_window.blocked_start < p_window_end
      AND buffered_window.blocked_end > p_window_start
  )
  INTO v_is_blocked;

  RETURN COALESCE(v_is_blocked, false);
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
  SELECT DISTINCT pb.id,
    w.starts_at - interval '30 minutes',
    CASE WHEN w.ends_at <= w.starts_at THEN w.ends_at + interval '1 day' ELSE w.ends_at END
      + interval '30 minutes'
  FROM public.private_bookings pb
  JOIN public.private_booking_items pi ON pi.booking_id = pb.id AND pi.item_type = 'space'
  JOIN public.venue_spaces vs ON vs.id = pi.space_id
  CROSS JOIN LATERAL (
    SELECT
      (COALESCE(pb.setup_date, pb.event_date) + COALESCE(pb.setup_time, pb.start_time))
        AT TIME ZONE 'Europe/London' AS starts_at,
      CASE WHEN pb.end_time IS NOT NULL
        THEN ((pb.event_date + CASE
          WHEN COALESCE(pb.end_time_next_day, false) OR pb.end_time <= pb.start_time THEN 1 ELSE 0 END)
          + pb.end_time) AT TIME ZONE 'Europe/London'
        ELSE (pb.event_date + pb.start_time) AT TIME ZONE 'Europe/London' + interval '4 hours'
      END AS ends_at
  ) w
  WHERE public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
    AND (p_booking_id IS NULL OR pb.id = p_booking_id)
    AND (vs.id = '6869774b-cfa5-4aff-a663-a14b2fb5633b'::uuid OR vs.blocks_all_spaces);
$function$;

REVOKE ALL ON FUNCTION public.outside_private_hire_windows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outside_private_hire_windows(uuid) TO service_role;

DROP FUNCTION public.get_private_booking_diner_clashes(uuid);
DROP FUNCTION public.private_hire_table_blocks(timestamp with time zone, timestamp with time zone, uuid);
DROP FUNCTION public.private_booking_occupied_window(date, time without time zone, time without time zone, boolean, date, time without time zone, time without time zone);
