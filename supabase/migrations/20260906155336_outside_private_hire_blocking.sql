SET lock_timeout = '3s';
SET statement_timeout = '30s';

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

CREATE OR REPLACE FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text DEFAULT 'food'::text, p_outside boolean DEFAULT false, p_requires_accessible_table boolean DEFAULT false, p_high_chair_count integer DEFAULT 0, p_channel text DEFAULT 'online'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hours RECORD;
  v_slot_step integer := 15;
  v_now timestamptz := NOW();
  v_max_online integer;
  v_slots jsonb := '[]'::jsonb;
  v_minutes integer;
  v_open_minutes integer;
  v_close_minutes integer;
  v_slot_time time;
  v_start timestamptz;
  v_end timestamptz;
  v_duration integer;
  v_turnaround integer;
  v_reason text;
  v_public text;
  v_available boolean;
  v_outside_needed integer;
  v_outside_used integer;
  v_outside_count integer;
  v_outside_capacity integer;
  v_high_chairs_left integer;
BEGIN
  IF p_booking_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object(
      'contract_version', 1,
      'calculation_state', 'unknown',
      'date', p_booking_date,
      'slots', '[]'::jsonb,
      'message', public.public_booking_message('unknown')
    );
  END IF;

  -- Above the online ceiling there is nothing to compute: it is a private booking.
  v_max_online := public.get_setting_int('table_booking_max_party_online', 20);
  IF p_channel = 'online' AND p_party_size > v_max_online THEN
    RETURN jsonb_build_object(
      'contract_version', 1,
      'calculation_state', 'complete',
      'date', p_booking_date,
      'party_size', p_party_size,
      'max_party_size_online', v_max_online,
      'slots', '[]'::jsonb,
      'public_reason', 'too_large',
      'message', public.public_booking_message('too_large')
    );
  END IF;

  SELECT
    COALESCE(sh.is_closed, bh.is_closed, false) AS is_closed,
    COALESCE(sh.is_kitchen_closed, bh.is_kitchen_closed, false) AS is_kitchen_closed,
    COALESCE(sh.opens, bh.opens) AS opens,
    COALESCE(sh.closes, bh.closes) AS closes,
    COALESCE(sh.kitchen_opens, bh.kitchen_opens) AS kitchen_opens,
    COALESCE(sh.kitchen_closes, bh.kitchen_closes) AS kitchen_closes
  INTO v_hours
  FROM public.business_hours_for_date(p_booking_date) bh
  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
  LIMIT 1;

  IF NOT FOUND OR v_hours.is_closed OR v_hours.opens IS NULL OR v_hours.closes IS NULL THEN
    RETURN jsonb_build_object(
      'contract_version', 1,
      'calculation_state', 'complete',
      'date', p_booking_date,
      'party_size', p_party_size,
      'slots', '[]'::jsonb,
      'public_reason', 'closed',
      'message', public.public_booking_message('closed')
    );
  END IF;

  -- Food is bounded by the kitchen; drinks by the pub.
  IF p_purpose = 'food' THEN
    IF v_hours.is_kitchen_closed OR v_hours.kitchen_opens IS NULL OR v_hours.kitchen_closes IS NULL THEN
      RETURN jsonb_build_object(
        'contract_version', 1,
        'calculation_state', 'complete',
        'date', p_booking_date,
        'party_size', p_party_size,
        'slots', '[]'::jsonb,
        'public_reason', 'closed',
        'message', public.public_booking_message('closed'),
        'kitchen_closed', true
      );
    END IF;
    v_open_minutes  := EXTRACT(HOUR FROM v_hours.kitchen_opens)::int * 60 + EXTRACT(MINUTE FROM v_hours.kitchen_opens)::int;
    v_close_minutes := EXTRACT(HOUR FROM v_hours.kitchen_closes)::int * 60 + EXTRACT(MINUTE FROM v_hours.kitchen_closes)::int;
  ELSE
    v_open_minutes  := EXTRACT(HOUR FROM v_hours.opens)::int * 60 + EXTRACT(MINUTE FROM v_hours.opens)::int;
    v_close_minutes := EXTRACT(HOUR FROM v_hours.closes)::int * 60 + EXTRACT(MINUTE FROM v_hours.closes)::int;
  END IF;

  IF v_close_minutes <= v_open_minutes THEN
    v_close_minutes := v_close_minutes + 1440;
  END IF;

  -- Duration, matching what the booking function will actually use.
  IF public.get_setting_bool('turn_times_enabled', false) THEN
    v_duration := CASE
      WHEN p_party_size <= 2 THEN public.get_setting_int('turn_time_minutes_1_2', 90)
      WHEN p_party_size <= 4 THEN public.get_setting_int('turn_time_minutes_3_4', 105)
      WHEN p_party_size <= 6 THEN public.get_setting_int('turn_time_minutes_5_6', 120)
      ELSE public.get_setting_int('turn_time_minutes_7_plus', 150)
    END;
    IF EXTRACT(DOW FROM p_booking_date)::int = 0 THEN
      v_duration := v_duration + public.get_setting_int('turn_time_sunday_uplift_minutes', 15);
    END IF;
    v_turnaround := public.get_setting_int('turnaround_gap_minutes', 15);
  ELSE
    v_duration := CASE WHEN p_purpose = 'food' THEN 120 ELSE 90 END;
    v_turnaround := 0;
  END IF;
  v_duration := GREATEST(30, v_duration);

  IF p_outside THEN
    v_outside_count    := public.get_setting_int('outside_table_count', 5);
    v_outside_capacity := GREATEST(1, public.get_setting_int('outside_table_capacity', 8));
    v_outside_needed   := GREATEST(1, CEIL(p_party_size::numeric / v_outside_capacity)::integer);
  END IF;

  -- The last slot must leave 30 minutes before service ends, matching the cut-off.
  v_minutes := v_open_minutes;
  WHILE v_minutes <= (v_close_minutes - 30) LOOP
    v_slot_time := make_time((v_minutes / 60) % 24, v_minutes % 60, 0);

    -- Do not offer a time the kitchen is not serving. Same rule as the creation
    -- guard (assert_booking_within_service_window), so the two cannot disagree.
    IF p_purpose = 'food' THEN
      IF NOT public.table_booking_within_service_window_v06(
               p_booking_date, v_slot_time, p_purpose, false) THEN
        v_minutes := v_minutes + v_slot_step;
        CONTINUE;
      END IF;
    END IF;
    v_start := ((p_booking_date + make_interval(mins => v_minutes))::timestamp) AT TIME ZONE 'Europe/London';
    v_end   := v_start + make_interval(mins => v_duration + v_turnaround);

    v_reason := NULL;

    IF v_start <= v_now THEN
      v_reason := 'in_past';
    ELSIF p_outside AND EXISTS (
      SELECT 1 FROM public.outside_private_hire_windows(NULL) w
      WHERE w.blocked_start < v_end AND w.blocked_end > v_start
    ) THEN
      -- Reuse the public outside-full message; internal private IDs stay private.
      v_reason := 'outside_full';
    ELSIF p_outside THEN
      SELECT COALESCE(SUM(r.tables_reserved), 0) INTO v_outside_used
        FROM public.outside_reservations r
        JOIN public.table_bookings tb ON tb.id = r.table_booking_id
       WHERE public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, v_now)
         AND public.windows_overlap(r.starts_at, r.ends_at, v_start, v_end);

      IF v_outside_used + v_outside_needed > v_outside_count THEN
        v_reason := 'outside_full';
      END IF;
    ELSE
      -- The same picker the booking function uses.
      IF NOT EXISTS (
        SELECT 1 FROM public.find_table_allocation_candidates(
          v_start, v_end, p_party_size, p_purpose,
          COALESCE(p_high_chair_count, 0), COALESCE(p_requires_accessible_table, false),
          NULL, COALESCE(p_channel, 'online'), NULL, NULL, v_now) c
        WHERE c.rank = 1
      ) THEN
        v_reason := 'no_table';
      END IF;
    END IF;

    -- Kitchen pacing, on arrivals, exactly as the booking function counts it.
    IF v_reason IS NULL AND p_purpose = 'food'
       AND public.get_setting_bool('kitchen_pacing_enabled', false) THEN
      DECLARE
        v_window integer := public.get_setting_int('kitchen_pacing_window_minutes', 30);
        v_is_sun boolean := EXTRACT(DOW FROM p_booking_date)::int = 0;
        v_pace integer;
        v_reserve integer;
        v_covers integer;
      BEGIN
        v_pace := public.get_setting_int(
          CASE WHEN v_is_sun THEN 'kitchen_pace_covers_sunday' ELSE 'kitchen_pace_covers_regular' END,
          CASE WHEN v_is_sun THEN 20 ELSE 25 END);
        v_reserve := public.get_setting_int(
          CASE WHEN v_is_sun THEN 'kitchen_walk_in_reserve_sunday' ELSE 'kitchen_walk_in_reserve_regular' END, 6);

        SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0) INTO v_covers
          FROM public.table_bookings tb
         WHERE tb.booking_date = p_booking_date
           AND COALESCE(tb.booking_purpose, 'food') = 'food'
           AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, v_now)
           AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int)
                 >= v_minutes - (v_window / 2.0)
           AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int)
                 <  v_minutes + (v_window / 2.0);

        IF v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN
          v_reason := 'slot_full';
        END IF;
      END;
    END IF;

    v_available := v_reason IS NULL;
    v_public := CASE WHEN v_available THEN NULL ELSE public.public_booking_reason(v_reason) END;

    -- How many high chairs are left, so the customer knows BEFORE booking rather than
    -- discovering it on arrival. High chairs never make a slot unavailable.
    v_high_chairs_left := GREATEST(0,
      public.get_setting_int('high_chair_inventory', 2)
      - public.count_high_chairs_in_window(v_start, v_end, NULL));

    v_slots := v_slots || jsonb_build_object(
      'time', to_char(v_slot_time, 'HH24:MI'),
      'state', CASE WHEN v_available THEN 'available' ELSE 'unavailable' END,
      'public_reason', v_public,
      'message', public.public_booking_message(v_public),
      'high_chairs_remaining', v_high_chairs_left
    );

    v_minutes := v_minutes + v_slot_step;
  END LOOP;

  RETURN jsonb_build_object(
    'contract_version', 1,
    'calculation_state', 'complete',
    'date', p_booking_date,
    'party_size', p_party_size,
    'purpose', p_purpose,
    'outside', COALESCE(p_outside, false),
    'requires_accessible_table', COALESCE(p_requires_accessible_table, false),
    'max_party_size_online', v_max_online,
    'duration_minutes', v_duration,
    'slots', v_slots
  );
EXCEPTION WHEN OTHERS THEN
  -- Never fail open. A calculation that broke is "unknown", not "available".
  RETURN jsonb_build_object(
    'contract_version', 1,
    'calculation_state', 'unknown',
    'date', p_booking_date,
    'party_size', p_party_size,
    'slots', '[]'::jsonb,
    'public_reason', 'unknown',
    'message', public.public_booking_message('unknown')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;


RESET lock_timeout;
RESET statement_timeout;
