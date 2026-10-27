-- Table availability rules agree everywhere (release 24 of the customer bookings review of
-- 24 October 2026: BK-144, BK-145, BK-146, BK-147; owner decision D30).
--
--   * BK-144. The booking function refuses an online drinks booking once a 30-minute arrival
--     window would pass the drinks ceiling (drinks_arrivals_ceiling, live 40), but the slot list
--     never checked it, so the website could offer a drinks time that booking then refused with a
--     vague line. table_booking_drinks_full(date, arrival minutes, party, now) now holds the rule,
--     and both create_table_booking_core_v06 and check_table_availability_v06 call it, so the two
--     cannot drift. The slot list answers 'drinks_full', which public_booking_reason now passes on
--     as its own public reason (it was shown as 'kitchen_full', the kitchen line, to a drinks
--     guest), with its own default message and a Settings message key. The date's own kitchen
--     pace and walk-in reserve already reached the slot list in
--     20261027133140_kitchen_pacing_counts_hire_and_event_food.
--   * BK-145. table_booking_turn_minutes(date, party, purpose) gives the visit length and the
--     turnaround gap exactly as the booking function works them out, for the late walk-in and
--     super-admin override, which used fixed 90 or 120 minutes with no turnaround.
--   * BK-146, D30. 20 is the table booking limit everywhere. create_table_booking_staff_v06 read
--     table_booking_max_party_staff (live 40) while every staff screen stopped at 20, so the
--     setting did nothing above 20. Staff bookings now read table_booking_max_party_online, the
--     staff setting is deleted and taken out of Settings, and the validator's staff-versus-online
--     comparison goes with it. The slot list applied the limit to the online channel only; it now
--     applies it to every channel, so the FOH free-times list offers nothing staff cannot book.
--   * BK-147, D30. Drinks bookings keep their table. Indoor drinks bookings were written with
--     assignment_soft = true ("yield it to a food booking"), and Settings showed "Let a food
--     booking move a drinks booking" (drinks_bump_enabled, live true) and a protection window
--     (drinks_bump_protection_minutes, live 60), but nothing read any of them. New bookings are
--     written with false, the two settings are deleted and taken out of Settings, and the column
--     comment says the flag is unused. The column stays (dropping it is a separate decision); the
--     15 old rows with true are left as they are, none of them upcoming, and nothing reads them.
--
-- Live data this changes: three system_settings rows are deleted (table_booking_max_party_staff 40,
-- drinks_bump_enabled true, drinks_bump_protection_minutes 60). No booking row is touched. A staff
-- booking of 21 to 40 guests, which no staff screen could send, is now refused by the database too.
-- A drinks time whose arrival window is already at the ceiling stops being offered online.
--
-- create_table_booking_core_v06, check_table_availability_v06, create_table_booking_staff_v06 and
-- validate_table_booking_settings are patched in place, as 20261016180511_kitchen_pacing_lone_party
-- did: the live definition is read with pg_get_functiondef, each old passage is replaced, and the
-- result is executed. The block refuses to run unless each old passage appears exactly once and its
-- replacement only where the old passage itself holds it, so a definition that has moved on fails
-- loudly instead of being half patched; a second run is a no-op. CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and
-- search_path; the grants are restated at the end anyway. Bodies checked against production on
-- 27 October 2026, md5(prosrc): create_table_booking_core_v06 7bd5ba3e1bbf40ad350248960e7b75dd,
-- check_table_availability_v06 18214f01b12cf1fe17a2ba04694ba12c, create_table_booking_staff_v06
-- 188703b01e45042d6331cf5026211bc5, validate_table_booking_settings bf261afa351dcbd590c39380b671cc46,
-- public_booking_reason fdc5b0896e431eb3146f541629f09d5a, public_booking_message
-- 47b4dc6e22555642ee13cd7f41bcd672, table_booking_settings_keys e27c2b9db619bb2a03086648c8f550a0.
-- Every function here is service_role only, as in production; none is callable by anon.
--
-- Rollback: tasks/table-availability-rules-agree/rollback.sql. Tested by
-- scripts/testing/table-availability-rules-agree-postgres.py.

CREATE FUNCTION public.table_booking_drinks_full(
  p_booking_date date,
  p_arrival_minutes integer,
  p_party_size integer,
  p_now timestamp with time zone DEFAULT now()
)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Drinks covers arriving in the window centred on this arrival time (the kitchen pacing window),
  -- plus this party, against the drinks ceiling. The one rule for the booking function and the
  -- slot list (BK-144).
  SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0) + p_party_size
           > public.get_setting_int('drinks_arrivals_ceiling', 40)
    FROM public.table_bookings tb
   WHERE tb.booking_date = p_booking_date
     AND COALESCE(tb.booking_purpose, 'food') = 'drinks'
     AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, p_now)
     AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int)
           >= p_arrival_minutes - (public.get_setting_int('kitchen_pacing_window_minutes', 30) / 2.0)
     AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int)
           <  p_arrival_minutes + (public.get_setting_int('kitchen_pacing_window_minutes', 30) / 2.0);
$function$;

COMMENT ON FUNCTION public.table_booking_drinks_full(date, integer, integer, timestamp with time zone) IS
  'True when this party would take the drinks arrivals in its window over drinks_arrivals_ceiling. Used by create_table_booking_core_v06 and check_table_availability_v06 (BK-144).';

REVOKE ALL ON FUNCTION public.table_booking_drinks_full(date, integer, integer, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.table_booking_drinks_full(date, integer, integer, timestamp with time zone) TO service_role;

CREATE FUNCTION public.table_booking_turn_minutes(p_booking_date date, p_party_size integer, p_purpose text)
 RETURNS TABLE(duration_minutes integer, turnaround_minutes integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purpose text := LOWER(TRIM(COALESCE(p_purpose, 'food')));
  v_duration integer;
  v_turnaround integer := 0;
BEGIN
  -- Exactly as create_table_booking_core_v06 works out a visit (BK-145). A Christmas booking is a
  -- food booking.
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
    v_duration := CASE WHEN v_purpose IN ('food', 'christmas') THEN 120 ELSE 90 END;
  END IF;

  duration_minutes := GREATEST(30, v_duration);
  turnaround_minutes := GREATEST(0, v_turnaround);
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.table_booking_turn_minutes(date, integer, text) IS
  'Visit length and turnaround gap for a table booking, as create_table_booking_core_v06 works them out. Used by the FOH walk-in override (BK-145).';

REVOKE ALL ON FUNCTION public.table_booking_turn_minutes(date, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.table_booking_turn_minutes(date, integer, text) TO service_role;

DO $patch$
DECLARE
  v_target record;
  v_oid oid;
  v_count integer;
  v_def text;
  v_old_hits integer;
  v_new_hits integer;
  v_old_in_new integer;
  v_new_in_old integer;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      (1, 'create_table_booking_core_v06',
$old$  IF v_purpose = 'drinks' AND NOT COALESCE(p_bypass_pacing, false) THEN
    v_pacing_window  := public.get_setting_int('kitchen_pacing_window_minutes', 30);
    v_center_minutes := EXTRACT(HOUR FROM p_booking_time)::int * 60 + EXTRACT(MINUTE FROM p_booking_time)::int;
    v_half := v_pacing_window / 2.0;

    SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0)
      INTO v_existing_covers
      FROM public.table_bookings tb
      WHERE tb.booking_date = p_booking_date
        AND COALESCE(tb.booking_purpose, 'food') = 'drinks'
        AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, v_now)
        AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) >= v_center_minutes - v_half
        AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) <  v_center_minutes + v_half;

    IF v_existing_covers + p_party_size > public.get_setting_int('drinks_arrivals_ceiling', 40) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'drinks_full');
    END IF;
  END IF;
$old$,
$new$  IF v_purpose = 'drinks' AND NOT COALESCE(p_bypass_pacing, false) THEN
    -- BK-144: the same helper the slot list asks, so the two cannot disagree.
    IF public.table_booking_drinks_full(
         p_booking_date,
         EXTRACT(HOUR FROM p_booking_time)::int * 60 + EXTRACT(MINUTE FROM p_booking_time)::int,
         p_party_size,
         v_now) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'drinks_full');
    END IF;
  END IF;
$new$),
      (2, 'create_table_booking_core_v06',
$old$    -- Drinks bookings hold a table but yield it to a food booking that has nowhere else to go.
    (v_purpose = 'drinks' AND NOT COALESCE(p_outside_seating, false)),
$old$,
$new$    -- Drinks bookings keep their table; nothing moves them (owner decision D30, BK-147).
    false,
$new$),
      (3, 'check_table_availability_v06',
$old$    v_available := v_reason IS NULL;
$old$,
$new$    -- BK-144: the drinks arrivals ceiling, by the same helper the booking function uses. Arrival
    -- minutes are the time of day, as the booking function reads booking_time.
    IF v_reason IS NULL AND p_purpose = 'drinks'
       AND public.table_booking_drinks_full(p_booking_date, v_minutes % 1440, p_party_size, v_now) THEN
      v_reason := 'drinks_full';
    END IF;

    v_available := v_reason IS NULL;
$new$),
      (4, 'create_table_booking_staff_v06',
$old$    public.get_setting_int('table_booking_max_party_staff', 40),
$old$,
$new$    -- One party limit for every channel (owner decision D30, BK-146).
    public.get_setting_int('table_booking_max_party_online', 20),
$new$),
      (5, 'validate_table_booking_settings',
$old$  IF p_section = 'party_limits' THEN
    DECLARE
      v_online numeric := COALESCE((p_payload -> 'table_booking_max_party_online' ->> 'value')::numeric,
                                   (SELECT (value ->> 'value')::numeric FROM public.system_settings WHERE key='table_booking_max_party_online'), 20);
      v_staff  numeric := COALESCE((p_payload -> 'table_booking_max_party_staff' ->> 'value')::numeric,
                                   (SELECT (value ->> 'value')::numeric FROM public.system_settings WHERE key='table_booking_max_party_staff'), 40);
    BEGIN
      IF v_online > v_staff THEN
        RETURN 'The online party limit cannot be larger than the staff limit';
      END IF;
    END;
  END IF;
$old$,
$new$  -- Owner decision D30: one party limit (table_booking_max_party_online) for every channel, so
  -- there is no staff limit to compare it with.
$new$),
      (6, 'check_table_availability_v06',
$old$  IF p_channel = 'online' AND p_party_size > v_max_online THEN
$old$,
$new$  -- One party limit for every channel (owner decision D30, BK-146): staff and walk-in slot lists
  -- offer nothing the staff booking function would refuse as too large.
  IF p_party_size > v_max_online THEN
$new$)
    ) AS t(step, proname, old_text, new_text)
    ORDER BY step
  LOOP
    SELECT count(*), min(p.oid) INTO v_count, v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_target.proname;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'table_availability_rules_agree: expected one %, found %', v_target.proname, v_count;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_old_hits := (length(v_def) - length(replace(v_def, v_target.old_text, ''))) / length(v_target.old_text);
    v_new_hits := (length(v_def) - length(replace(v_def, v_target.new_text, ''))) / length(v_target.new_text);
    -- A replacement may keep its old passage inside it (or the other way round), so the counts
    -- expected before and after are worked out from the two texts themselves.
    v_old_in_new := (length(v_target.new_text) - length(replace(v_target.new_text, v_target.old_text, '')))
      / length(v_target.old_text);
    v_new_in_old := (length(v_target.old_text) - length(replace(v_target.old_text, v_target.new_text, '')))
      / length(v_target.new_text);

    IF v_new_hits = 1 AND v_old_hits = v_old_in_new THEN
      RAISE NOTICE 'table_availability_rules_agree: % step % already applied, skipped', v_target.proname, v_target.step;
      CONTINUE;
    END IF;

    IF v_old_hits <> 1 OR v_new_hits <> v_new_in_old THEN
      RAISE EXCEPTION 'table_availability_rules_agree: % step % found % old and % new passages, expected 1 and %',
        v_target.proname, v_target.step, v_old_hits, v_new_hits, v_new_in_old;
    END IF;

    EXECUTE replace(v_def, v_target.old_text, v_target.new_text);
    RAISE NOTICE 'table_availability_rules_agree: % step % patched', v_target.proname, v_target.step;
  END LOOP;
END
$patch$;

-- BK-144: drinks_full is its own public reason, so a drinks guest is not told the kitchen is full.
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
    WHEN 'drinks_full'         THEN 'drinks_full'
    WHEN 'outside_full'        THEN 'outside_full'
    WHEN 'outside_hours'       THEN 'closed'
    WHEN 'hours_not_configured' THEN 'closed'
    WHEN 'in_past'             THEN 'closed'
    WHEN 'cut_off'             THEN 'too_late'
    WHEN 'too_large_party'     THEN 'too_large'
    ELSE 'unknown'                                   -- anything unmapped fails safe
  END;
$$;

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
    WHEN 'drinks_full'  THEN 'We have a lot of guests arriving for drinks at that time. There is usually room a little earlier or later, or give us a ring.'
    WHEN 'outside_full' THEN 'All our outside tables are taken for that time. We can seat you inside if you would like.'
    WHEN 'closed'       THEN 'We are closed then. Have a look at our opening times for another day.'
    WHEN 'too_late'     THEN 'That is a little too close to closing for us to seat you. Please pick an earlier time.'
    WHEN 'too_large'    THEN 'For a group that size we look after you as a private booking. Get in touch and we will sort it out.'
    ELSE 'We cannot check availability right now. Please give us a ring and we will book you in.'
  END);
END;
$$;

-- D30: the staff party limit and the two drinks-yield settings leave Settings; the drinks message
-- joins it.
CREATE OR REPLACE FUNCTION public.table_booking_settings_keys(p_section text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'turn_times' THEN ARRAY[
      'turn_time_minutes_1_2','turn_time_minutes_3_4','turn_time_minutes_5_6',
      'turn_time_minutes_7_plus','turn_time_sunday_uplift_minutes','turnaround_gap_minutes',
      'turn_times_enabled']
    WHEN 'kitchen_pacing' THEN ARRAY[
      'kitchen_pacing_enabled','kitchen_pacing_window_minutes',
      'kitchen_pace_covers_regular','kitchen_pace_covers_sunday',
      'kitchen_walk_in_reserve_regular','kitchen_walk_in_reserve_sunday']
    WHEN 'outside' THEN ARRAY['outside_table_count','outside_table_capacity']
    WHEN 'drinks' THEN ARRAY['drinks_arrivals_ceiling']
    WHEN 'party_limits' THEN ARRAY['table_booking_max_party_online']
    WHEN 'holds' THEN ARRAY['hold_release_lead_hours','table_holds_enabled']
    WHEN 'deposits' THEN ARRAY['booking_period_deposits_enabled']
    WHEN 'messages' THEN ARRAY[
      'booking_message_tables_full','booking_message_kitchen_full','booking_message_drinks_full',
      'booking_message_outside_full','booking_message_closed','booking_message_too_late',
      'booking_message_too_large','booking_message_unknown']
    ELSE ARRAY[]::text[]
  END;
$$;

DELETE FROM public.system_settings
 WHERE key IN ('table_booking_max_party_staff', 'drinks_bump_enabled', 'drinks_bump_protection_minutes');

COMMENT ON COLUMN public.table_bookings.assignment_soft IS
  'Unused. Drinks bookings keep their table (owner decision D30, BK-147); new bookings are written with false and nothing reads it.';

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;

REVOKE ALL ON FUNCTION public.validate_table_booking_settings(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_table_booking_settings(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.public_booking_reason(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_reason(text) TO service_role;

REVOKE ALL ON FUNCTION public.public_booking_message(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_message(text) TO service_role;

REVOKE ALL ON FUNCTION public.table_booking_settings_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.table_booking_settings_keys(text) TO service_role;
