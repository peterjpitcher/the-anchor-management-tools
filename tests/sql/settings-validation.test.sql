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
