-- No customer records are changed. This UUID is the existing garden venue space,
-- verified against production. A rename must not change availability semantics.
CREATE OR REPLACE FUNCTION public.outside_private_hire_windows(p_booking_id uuid DEFAULT NULL)
RETURNS TABLE (booking_id uuid, blocked_start timestamptz, blocked_end timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public
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
  WHERE pb.status IN ('draft', 'confirmed')
    AND (p_booking_id IS NULL OR pb.id = p_booking_id)
    AND (vs.id = '6869774b-cfa5-4aff-a663-a14b2fb5633b'::uuid OR vs.blocks_all_spaces);
$function$;
REVOKE ALL ON FUNCTION public.outside_private_hire_windows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outside_private_hire_windows(uuid) TO service_role;

-- Table writers share a dedicated lock: a prelocked staff move/payment can join
-- another table writer without waiting, so no row/advisory lock inversion occurs.
-- Private-hire guards take the exclusive side only AFTER their normal row locks,
-- then perform nonlocking reads. Neither side takes the allocator's table_alloc lock.
CREATE OR REPLACE FUNCTION public.lock_outside_private_hire_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('outside_private_hire'));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_outside_private_hire_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_outside_private_hire_inventory() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_outside_private_hire_table_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_end timestamptz;
BEGIN
  IF NOT COALESCE(NEW.is_outside_seating, false)
     OR NOT public.is_booking_live(NEW.status, NEW.left_at, NEW.hold_expires_at, NEW.payment_status, now()) THEN
    RETURN NEW;
  END IF;
  v_end := NEW.end_datetime + make_interval(mins => CASE
    WHEN public.get_setting_bool('turn_times_enabled', false)
    THEN GREATEST(0, public.get_setting_int('turnaround_gap_minutes', 15)) ELSE 0 END);
  IF NEW.start_datetime IS NULL OR v_end IS NULL OR v_end <= NEW.start_datetime THEN
    RAISE EXCEPTION 'outside_booking_missing_window' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.outside_private_hire_windows(NULL) w
    WHERE w.blocked_start < v_end AND w.blocked_end > NEW.start_datetime) THEN
    RAISE EXCEPTION 'table_assignment_private_blocked: outside space is reserved for private hire'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_outside_private_hire_table_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_outside_private_hire_table_booking() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_private_hire_outside_bookings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_booking_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('outside_private_hire'));
  IF TG_TABLE_NAME = 'private_bookings' THEN
    v_booking_id := NEW.id;
  ELSE
    v_booking_id := NEW.booking_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.outside_private_hire_windows(v_booking_id) w
    JOIN public.table_bookings tb ON tb.is_outside_seating
      AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, now())
    LEFT JOIN public.outside_reservations r ON r.table_booking_id = tb.id
    WHERE w.blocked_start < COALESCE(r.ends_at, tb.end_datetime + make_interval(mins => CASE
      WHEN public.get_setting_bool('turn_times_enabled', false)
      THEN GREATEST(0, public.get_setting_int('turnaround_gap_minutes', 15)) ELSE 0 END))
      AND w.blocked_end > tb.start_datetime
  ) THEN
    RAISE EXCEPTION 'The garden already has an outside table booking during this private hire. Resolve the table booking before reserving this space.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_private_hire_outside_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_private_hire_outside_bookings() TO service_role;

CREATE TRIGGER outside_private_hire_table_lock BEFORE INSERT OR UPDATE ON public.table_bookings
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_outside_private_hire_inventory();

CREATE TRIGGER zz_outside_private_hire_table_guard BEFORE INSERT OR UPDATE OF
is_outside_seating, start_datetime, end_datetime, status, left_at, hold_expires_at, payment_status, party_size
ON public.table_bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_outside_private_hire_table_booking();
CREATE TRIGGER outside_private_hire_booking_guard AFTER UPDATE OF
status, event_date, start_time, end_time, end_time_next_day, setup_date, setup_time ON public.private_bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_private_hire_outside_bookings();
CREATE TRIGGER outside_private_hire_item_guard AFTER INSERT OR UPDATE OF booking_id, space_id, item_type
ON public.private_booking_items FOR EACH ROW EXECUTE FUNCTION public.enforce_private_hire_outside_bookings();
