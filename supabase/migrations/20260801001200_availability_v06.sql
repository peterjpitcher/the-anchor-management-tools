-- Table prioritisation, stream B task B10 and stream C.
-- check_table_availability_v06: the availability the customer is shown.
--
-- Today `GET /api/table-bookings/load` never touches `tables`, `booking_table_assignments`,
-- `table_join_links` or `event_communal_seat_allocations`. It counts kitchen covers and nothing
-- else, so the website can offer 7pm when every table is taken and the customer only finds out
-- after filling in the whole form. It is not even party-size aware.
--
-- This asks the SAME picker the booking function asks. If availability says yes, create uses
-- identical rules against identical state.
--
-- Two things the review insisted on, and both are load-bearing:
--
--   Internal reason codes NEVER leave the database. A private booking and a maintenance block both
--   surface as `tables_full`. A customer is never told a function is on.
--
--   `unknown` is a real answer. If the calculation itself fails, the caller must say "we cannot
--   check right now, please ring" rather than guessing. Never fail open.
--
-- Availability does NOT model the drinks bump: a slot that would only be bookable by relocating
-- someone else reads as unavailable, and create may still succeed. False-unavailable is safe.
-- False-available is the defect this release exists to remove.

BEGIN;

-- ---------------------------------------------------------------------------
-- Internal reason -> public reason. The mapping is the privacy boundary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_booking_reason(p_internal text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_internal
    WHEN 'no_table'            THEN 'tables_full'
    WHEN 'table_occupied'      THEN 'tables_full'
    WHEN 'table_private_block' THEN 'tables_full'   -- never disclose a function
    WHEN 'table_blocked'       THEN 'tables_full'   -- never disclose maintenance
    WHEN 'table_communal'      THEN 'tables_full'
    WHEN 'table_held'          THEN 'tables_full'
    WHEN 'table_not_bookable'  THEN 'tables_full'
    WHEN 'too_large_for_table' THEN 'tables_full'
    WHEN 'below_table_minimum' THEN 'tables_full'
    WHEN 'not_accessible'      THEN 'tables_full'
    WHEN 'no_high_chair_here'  THEN 'tables_full'
    WHEN 'slot_full'           THEN 'kitchen_full'
    WHEN 'drinks_full'         THEN 'kitchen_full'
    WHEN 'outside_full'        THEN 'outside_full'
    WHEN 'outside_hours'       THEN 'closed'
    WHEN 'hours_not_configured' THEN 'closed'
    WHEN 'in_past'             THEN 'closed'
    WHEN 'cut_off'             THEN 'too_late'
    WHEN 'too_large_party'     THEN 'too_large'
    ELSE 'unknown'                                   -- anything unmapped fails safe
  END;
$$;

COMMENT ON FUNCTION public.public_booking_reason IS
  'Maps an internal reason to the short public enum. A private booking and a maintenance block both become tables_full: the customer is never told why a table is unavailable in a way that discloses venue business.';

-- ---------------------------------------------------------------------------
-- The customer-facing message for a public reason, editable in settings.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_booking_message(p_public_reason text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_msg text;
BEGIN
  IF p_public_reason IS NULL THEN RETURN NULL; END IF;

  SELECT value ->> 'value' INTO v_msg
    FROM public.system_settings
   WHERE key = 'booking_message_' || p_public_reason;

  -- Immutable safe defaults, so a blank or deleted setting cannot leave a customer
  -- staring at nothing.
  RETURN COALESCE(NULLIF(btrim(v_msg), ''), CASE p_public_reason
    WHEN 'tables_full'  THEN 'We are fully booked at that time. Please try another time or give us a ring.'
    WHEN 'kitchen_full' THEN 'Our kitchen is at capacity for that time. There is usually room a little earlier or later.'
    WHEN 'outside_full' THEN 'All our outside tables are taken for that time. We can seat you inside if you would like.'
    WHEN 'closed'       THEN 'We are closed then. Have a look at our opening times for another day.'
    WHEN 'too_late'     THEN 'That is a little too close to closing for us to seat you. Please pick an earlier time.'
    WHEN 'too_large'    THEN 'For a group that size we look after you as a private booking. Get in touch and we will sort it out.'
    ELSE 'We cannot check availability right now. Please give us a ring and we will book you in.'
  END);
END;
$$;

-- ---------------------------------------------------------------------------
-- Availability for a whole date, in one call.
--
-- One call per date, not one per slot: the website re-requests on every party-size
-- change, so a per-slot round trip would be an N+1 on the hottest customer path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_table_availability_v06(
  p_booking_date              date,
  p_party_size                integer,
  p_purpose                   text    DEFAULT 'food',
  p_outside                   boolean DEFAULT false,
  p_requires_accessible_table boolean DEFAULT false,
  p_high_chair_count          integer DEFAULT 0,
  p_channel                   text    DEFAULT 'online'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
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
  FROM public.business_hours bh
  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
  WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer
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
    v_start := ((p_booking_date + make_interval(mins => v_minutes))::timestamp) AT TIME ZONE 'Europe/London';
    v_end   := v_start + make_interval(mins => v_duration + v_turnaround);

    v_reason := NULL;

    IF v_start <= v_now THEN
      v_reason := 'in_past';
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

COMMENT ON FUNCTION public.check_table_availability_v06 IS
  'Whole-date availability using the same picker as create. Returns public reason codes only. calculation_state unknown means the calculation failed and the caller must not treat any slot as bookable.';

REVOKE ALL ON FUNCTION public.check_table_availability_v06(date, integer, text, boolean, boolean, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_booking_reason(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_booking_message(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(date, integer, text, boolean, boolean, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_booking_reason(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_booking_message(text) TO service_role;

COMMIT;
