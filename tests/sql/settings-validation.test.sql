-- Regression tests for the settings gate.
--
-- Review finding F1 was a P0: a manager saving a decimal was accepted, and then every call to the
-- shared table picker failed on an integer cast. One allowed action stopped all bookings until the
-- row was repaired by hand. These tests exist so that cannot return.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.save(p_section text, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_rev bigint; BEGIN
  SELECT revision INTO v_rev FROM public.settings_revisions WHERE section = p_section;
  RETURN public.set_table_booking_settings(p_section, p_payload, v_rev, NULL);
END; $$;

DO $$
DECLARE r jsonb;
BEGIN
  -- ===================================================================
  -- F1. Integer settings must reject anything that is not a whole number.
  -- ===================================================================
  r := pg_temp.save('holds', '{"hold_release_lead_hours":{"value":24.5}}');
  ASSERT (r ->> 'ok')::boolean = false,
    format('a fractional hold_release_lead_hours must be rejected, got %s', r);

  r := pg_temp.save('holds', '{"hold_release_lead_hours":{"value":"soon"}}');
  ASSERT (r ->> 'ok')::boolean = false, 'a non-numeric integer setting must be rejected';

  r := pg_temp.save('turn_times', '{"turn_time_minutes_1_2":{"value":90.5}}');
  ASSERT (r ->> 'ok')::boolean = false, 'a fractional turn time must be rejected';

  -- A whole number still saves.
  r := pg_temp.save('holds', '{"hold_release_lead_hours":{"value":12}}');
  ASSERT (r ->> 'ok')::boolean = true, format('a whole number must save, got %s', r);

  -- ===================================================================
  -- Shape. The payload must be {"value": ...} and never null.
  -- ===================================================================
  r := pg_temp.save('holds', '{"hold_release_lead_hours":24}');
  ASSERT (r ->> 'ok')::boolean = false, 'a bare scalar must be rejected';

  r := pg_temp.save('holds', '{"hold_release_lead_hours":{"value":null}}');
  ASSERT (r ->> 'ok')::boolean = false, 'a null value must be rejected';

  r := pg_temp.save('holds', '{"hold_release_lead_hours":{"nope":24}}');
  ASSERT (r ->> 'ok')::boolean = false, 'a payload with no value property must be rejected';

  -- Keys from another section are refused rather than silently ignored.
  r := pg_temp.save('holds', '{"outside_table_count":{"value":5}}');
  ASSERT (r ->> 'ok')::boolean = false, 'a key from another section must be rejected';

  -- ===================================================================
  -- The picker must survive a value that was somehow stored badly, rather than
  -- taking every booking down with it.
  -- ===================================================================
  UPDATE public.system_settings SET value = '{"value": 24.5}'
   WHERE key = 'hold_release_lead_hours';

  ASSERT (SELECT count(*) FROM public.find_table_allocation_candidates(
            '2026-09-16 18:00+01','2026-09-16 20:00+01', 2)) > 0,
    'a corrupted stored setting must fall back to the coded default, not break allocation';

  ASSERT public.get_setting_int('hold_release_lead_hours', 24) = 24,
    'get_setting_int must return the coded default for a malformed value';

  UPDATE public.system_settings SET value = '{"value": 24}'
   WHERE key = 'hold_release_lead_hours';

  -- ===================================================================
  -- Walk-in reserve must be strictly below the pace: equality closes online
  -- booking completely, because the ceiling is GREATEST(0, pace - reserve).
  -- ===================================================================
  PERFORM pg_temp.save('kitchen_pacing', '{"kitchen_pacing_enabled":{"value":true}}');

  r := pg_temp.save('kitchen_pacing',
    '{"kitchen_pace_covers_regular":{"value":10},"kitchen_walk_in_reserve_regular":{"value":10}}');
  ASSERT (r ->> 'ok')::boolean = false,
    format('reserve equal to pace must be rejected while pacing is on, got %s', r);

  r := pg_temp.save('kitchen_pacing',
    '{"kitchen_pace_covers_regular":{"value":15},"kitchen_walk_in_reserve_regular":{"value":0}}');
  ASSERT (r ->> 'ok')::boolean = true, format('a sane pace and reserve must save, got %s', r);

  -- ===================================================================
  -- A partial turn-time update is checked against what is STORED, not against
  -- coded defaults, so it cannot slip an out-of-order band past the validator.
  -- ===================================================================
  PERFORM pg_temp.save('turn_times',
    '{"turn_time_minutes_1_2":{"value":200},"turn_time_minutes_3_4":{"value":210},
      "turn_time_minutes_5_6":{"value":220},"turn_time_minutes_7_plus":{"value":230}}');

  r := pg_temp.save('turn_times', '{"turn_time_minutes_7_plus":{"value":150}}');
  ASSERT (r ->> 'ok')::boolean = false,
    format('a partial update that breaks the ordering against stored values must be rejected, got %s', r);

  -- ===================================================================
  -- F9. Lowering outside capacity re-costs bookings already taken, so it is
  -- refused until the re-costing workflow exists. Raising it is fine.
  -- ===================================================================
  r := pg_temp.save('outside', '{"outside_table_capacity":{"value":6}}');
  ASSERT (r ->> 'ok')::boolean = false,
    format('lowering outside table capacity must be refused, got %s', r);

  r := pg_temp.save('outside', '{"outside_table_capacity":{"value":10}}');
  ASSERT (r ->> 'ok')::boolean = true,
    format('raising outside table capacity must be allowed, got %s', r);

  -- ===================================================================
  -- Optimistic concurrency: a stale revision loses cleanly.
  -- ===================================================================
  r := public.set_table_booking_settings('holds', '{"hold_release_lead_hours":{"value":18}}', 1, NULL);
  ASSERT (r ->> 'ok')::boolean = false, 'a stale revision must be rejected';

  RAISE NOTICE 'ALL SETTINGS TESTS PASSED';
END;
$$;

-- =====================================================================
-- Grants. Added after every one of the twenty new functions reached
-- production executable by anon, because REVOKE ... FROM PUBLIC does not
-- remove a grant Supabase makes to a named role. This asserts the door is
-- shut, so a rebuild cannot quietly reopen it.
-- =====================================================================
DO $$
DECLARE v_leaky text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_leaky
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'find_table_allocation_candidates','check_table_availability_v06','create_table_booking_core_v06',
      'create_table_booking_staff_v06','set_table_booking_settings','get_table_booking_settings',
      'allocate_event_communal_seats_v02','is_booking_live',
      -- The high-chair and outside-seating primitives. The first two predate the lock-down
      -- migration and were still open in production when 20260801001400 was written.
      'reserve_high_chairs','count_high_chairs_in_window',
      'sync_outside_reservation','trg_sync_outside_reservation')
    AND array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  ASSERT v_leaky IS NULL,
    format('these must never be callable by anon or authenticated: %s', v_leaky);

  RAISE NOTICE 'ALL GRANT TESTS PASSED';
END;
$$;
