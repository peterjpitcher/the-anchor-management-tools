-- Table prioritisation, stream A task A8.
-- Authoritative read and write for the table-booking settings, with per-section optimistic concurrency
-- and server-side validation.
--
-- Review finding F-17: system_settings stores one row per key with its own updated_at, so a single
-- expected_updated_at cannot protect a section made of several keys. This adds an explicit revision
-- counter per section instead. A stale browser tab now loses cleanly rather than silently overwriting
-- half of someone else's change.
--
-- Review finding F-24: validation lives here, in the database, not only in the settings page. Bypassing
-- the UI cannot put the venue into a state where nobody can book.

BEGIN;

-- ---------------------------------------------------------------------------
-- Revision counter, one row per settings section
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings_revisions (
  section     text PRIMARY KEY,
  revision    bigint NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

COMMENT ON TABLE public.settings_revisions IS
  'Optimistic concurrency for multi-key settings sections. Bumped on every successful section write.';

INSERT INTO public.settings_revisions (section)
VALUES ('tables'), ('turn_times'), ('kitchen_pacing'), ('outside'), ('drinks'),
       ('party_limits'), ('holds'), ('messages')
ON CONFLICT (section) DO NOTHING;

ALTER TABLE public.settings_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_revisions_service_role_all ON public.settings_revisions;
CREATE POLICY settings_revisions_service_role_all ON public.settings_revisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Typed key registry.
--
-- Review finding F1 (P0): the first version validated numbers as `numeric` and
-- then the allocator cast the stored text straight to `integer`. A manager saving
-- `hold_release_lead_hours = 24.5` was accepted, and every subsequent call to
-- find_table_allocation_candidates died on
--   invalid input syntax for type integer: "24.5"
-- One allowed action stopped every booking in the pub until someone repaired the
-- row by hand. The database now owns the type of every key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.table_booking_setting_type(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_key LIKE 'booking_message_%' THEN 'text'
    WHEN p_key LIKE '%_enabled'         THEN 'bool'
    ELSE 'int'
  END;
$$;

-- Guarded reads. A malformed stored value returns the coded default and warns,
-- rather than taking the booking system down. Nothing reads system_settings for
-- these keys directly any more.
CREATE OR REPLACE FUNCTION public.get_setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw text;
  v_num numeric;
BEGIN
  SELECT value ->> 'value' INTO v_raw FROM public.system_settings WHERE key = p_key;
  IF v_raw IS NULL THEN
    RETURN p_default;
  END IF;

  BEGIN
    v_num := v_raw::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Setting % is not a number (%); using default %', p_key, v_raw, p_default;
    RETURN p_default;
  END;

  IF v_num <> trunc(v_num) THEN
    RAISE WARNING 'Setting % is not a whole number (%); using default %', p_key, v_raw, p_default;
    RETURN p_default;
  END IF;

  RETURN v_num::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_setting_bool(p_key text, p_default boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_val jsonb;
BEGIN
  SELECT value -> 'value' INTO v_val FROM public.system_settings WHERE key = p_key;
  IF v_val IS NULL OR jsonb_typeof(v_val) <> 'boolean' THEN
    RETURN p_default;
  END IF;
  RETURN v_val::text::boolean;
END;
$$;

-- ---------------------------------------------------------------------------
-- Which keys belong to which section. Kept in SQL so the database, not the UI,
-- decides what a section is.
-- ---------------------------------------------------------------------------
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
    WHEN 'drinks' THEN ARRAY[
      'drinks_arrivals_ceiling','drinks_bump_enabled','drinks_bump_protection_minutes']
    WHEN 'party_limits' THEN ARRAY[
      'table_booking_max_party_online','table_booking_max_party_staff']
    WHEN 'holds' THEN ARRAY['hold_release_lead_hours','table_holds_enabled']
    WHEN 'messages' THEN ARRAY[
      'booking_message_tables_full','booking_message_kitchen_full','booking_message_outside_full',
      'booking_message_closed','booking_message_too_late','booking_message_too_large',
      'booking_message_unknown']
    ELSE ARRAY[]::text[]
  END;
$$;

-- ---------------------------------------------------------------------------
-- Read. Returns every setting plus the revision per section, so the client can
-- send the revision back on save.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_table_booking_settings()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'settings', COALESCE((
      SELECT jsonb_object_agg(s.key, s.value)
      FROM public.system_settings s
      WHERE s.key = ANY (
        public.table_booking_settings_keys('turn_times')
        || public.table_booking_settings_keys('kitchen_pacing')
        || public.table_booking_settings_keys('outside')
        || public.table_booking_settings_keys('drinks')
        || public.table_booking_settings_keys('party_limits')
        || public.table_booking_settings_keys('holds')
        || public.table_booking_settings_keys('messages')
        || ARRAY['table_allocation_v06_enabled','accessibility_filter_enabled','high_chair_inventory']
      )
    ), '{}'::jsonb),
    'revisions', COALESCE((
      SELECT jsonb_object_agg(r.section, r.revision) FROM public.settings_revisions r
    ), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Validation. Every rule that must hold whatever the caller does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_table_booking_settings(p_section text, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE   -- reads system_settings to merge partial payloads; must not be IMMUTABLE
AS $$
DECLARE
  v_key      text;
  v_num      numeric;
  v_txt      text;
  v_allowed  text[] := public.table_booking_settings_keys(p_section);
BEGIN
  IF array_length(v_allowed, 1) IS NULL THEN
    RETURN format('Unknown settings section "%s"', p_section);
  END IF;

  -- Reject unknown keys outright rather than silently ignoring them.
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RETURN format('Key "%s" does not belong to section "%s"', v_key, p_section);
    END IF;
  END LOOP;

  -- Shape: every value must be an object carrying a non-null `value` property.
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF jsonb_typeof(p_payload -> v_key) <> 'object'
       OR NOT (p_payload -> v_key ? 'value')
       OR jsonb_typeof(p_payload -> v_key -> 'value') = 'null' THEN
      RETURN format('"%s" must be an object of the form {"value": ...}', v_key);
    END IF;
  END LOOP;

  -- Numeric ranges.
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF v_key LIKE 'booking_message_%' THEN
      v_txt := p_payload -> v_key ->> 'value';
      IF v_txt IS NULL OR length(btrim(v_txt)) = 0 THEN
        RETURN format('Message "%s" cannot be blank', v_key);
      END IF;
      IF length(v_txt) > 200 THEN
        RETURN format('Message "%s" is %s characters; the limit is 200', v_key, length(v_txt));
      END IF;
      IF v_txt ~ '[<>]' THEN
        RETURN format('Message "%s" must be plain text with no angle brackets', v_key);
      END IF;
      CONTINUE;
    END IF;

    IF v_key LIKE '%_enabled' THEN
      IF jsonb_typeof(p_payload -> v_key -> 'value') <> 'boolean' THEN
        RETURN format('"%s" must be true or false', v_key);
      END IF;
      CONTINUE;
    END IF;

    BEGIN
      v_num := (p_payload -> v_key ->> 'value')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN format('"%s" must be a number', v_key);
    END;

    IF v_num IS NULL OR v_num < 0 THEN
      RETURN format('"%s" cannot be negative', v_key);
    END IF;

    -- F1: every numeric key here is read as an integer downstream.
    IF public.table_booking_setting_type(v_key) = 'int' AND v_num <> trunc(v_num) THEN
      RETURN format('"%s" must be a whole number, not %s', v_key, v_num);
    END IF;

    IF v_key LIKE 'turn_time_minutes_%' AND (v_num < 30 OR v_num > 480) THEN
      RETURN format('"%s" must be between 30 and 480 minutes', v_key);
    END IF;
    IF v_key = 'turnaround_gap_minutes' AND v_num > 60 THEN
      RETURN 'The turnaround gap must be 60 minutes or less';
    END IF;
    IF v_key = 'turn_time_sunday_uplift_minutes' AND v_num > 120 THEN
      RETURN 'The Sunday uplift must be 120 minutes or less';
    END IF;
    IF v_key = 'hold_release_lead_hours' AND v_num > 168 THEN
      RETURN 'The hold release lead time must be 168 hours (one week) or less';
    END IF;
    IF v_key IN ('outside_table_count','outside_table_capacity') AND v_num < 1 THEN
      RETURN format('"%s" must be at least 1', v_key);
    END IF;
    IF v_key = 'kitchen_pacing_window_minutes' AND (v_num < 5 OR v_num > 240) THEN
      RETURN 'The pacing window must be between 5 and 240 minutes';
    END IF;
    IF v_key LIKE 'table_booking_max_party_%' AND (v_num < 1 OR v_num > 200) THEN
      RETURN format('"%s" must be between 1 and 200', v_key);
    END IF;
  END LOOP;

  -- Cross-field rules, evaluated against the merged result so a partial payload
  -- cannot sneak past by only sending one side of a pair.
  IF p_section = 'kitchen_pacing' THEN
    DECLARE
      v_pace_r    numeric := COALESCE((p_payload -> 'kitchen_pace_covers_regular' ->> 'value')::numeric,
                                      (SELECT (value ->> 'value')::numeric FROM public.system_settings WHERE key='kitchen_pace_covers_regular'), 25);
      v_pace_s    numeric := COALESCE((p_payload -> 'kitchen_pace_covers_sunday' ->> 'value')::numeric,
                                      (SELECT (value ->> 'value')::numeric FROM public.system_settings WHERE key='kitchen_pace_covers_sunday'), 20);
      v_res_r     numeric := COALESCE((p_payload -> 'kitchen_walk_in_reserve_regular' ->> 'value')::numeric,
                                      (SELECT (value ->> 'value')::numeric FROM public.system_settings WHERE key='kitchen_walk_in_reserve_regular'), 6);
      v_res_s     numeric := COALESCE((p_payload -> 'kitchen_walk_in_reserve_sunday' ->> 'value')::numeric,
                                      (SELECT (value ->> 'value')::numeric FROM public.system_settings WHERE key='kitchen_walk_in_reserve_sunday'), 6);
    BEGIN
      -- The live ceiling is GREATEST(0, pace - reserve), so equality closes online
      -- booking completely. Only reject it while pacing is switched on.
      IF public.get_setting_bool('kitchen_pacing_enabled', false) THEN
        IF v_res_r >= v_pace_r THEN
          RETURN 'The weekday walk-in reserve must be smaller than the weekday pace, or nothing can be booked online';
        END IF;
        IF v_res_s >= v_pace_s THEN
          RETURN 'The Sunday walk-in reserve must be smaller than the Sunday pace, or nothing can be booked online';
        END IF;
      END IF;
    END;
  END IF;

  IF p_section = 'party_limits' THEN
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

  IF p_section = 'turn_times' THEN
    DECLARE
      -- Merge against what is stored, so a partial update cannot slip past by
      -- sending only one band and being compared with a coded default.
      v_a numeric := COALESCE((p_payload -> 'turn_time_minutes_1_2' ->> 'value')::numeric,
                              public.get_setting_int('turn_time_minutes_1_2', 90));
      v_b numeric := COALESCE((p_payload -> 'turn_time_minutes_3_4' ->> 'value')::numeric,
                              public.get_setting_int('turn_time_minutes_3_4', 105));
      v_c numeric := COALESCE((p_payload -> 'turn_time_minutes_5_6' ->> 'value')::numeric,
                              public.get_setting_int('turn_time_minutes_5_6', 120));
      v_d numeric := COALESCE((p_payload -> 'turn_time_minutes_7_plus' ->> 'value')::numeric,
                              public.get_setting_int('turn_time_minutes_7_plus', 150));
    BEGIN
      IF NOT (v_a <= v_b AND v_b <= v_c AND v_c <= v_d) THEN
        RETURN 'Turn times must not get shorter as the party gets bigger';
      END IF;
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Write. One section, atomically, with an audit row in the same transaction.
--
-- p_actor_id is supplied by the AMS route AFTER it has run the existing
-- settings:manage permission check. It is never taken from a public caller,
-- which is why this function is service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_table_booking_settings(
  p_section          text,
  p_payload          jsonb,
  p_expected_revision bigint,
  p_actor_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_error        text;
  v_current_rev  bigint;
  v_key          text;
  v_old          jsonb;
  v_new_rev      bigint;
BEGIN
  v_error := public.validate_table_booking_settings(p_section, p_payload);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_error);
  END IF;

  SELECT revision INTO v_current_rev
    FROM public.settings_revisions
   WHERE section = p_section
     FOR UPDATE;

  IF v_current_rev IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Unknown settings section "%s"', p_section));
  END IF;

  IF v_current_rev <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'These settings were changed by someone else while this page was open. Reload and try again.',
      'current_revision', v_current_rev
    );
  END IF;

  -- Review finding F9: lowering outside_table_capacity silently re-costs every
  -- existing future outside booking. Until the dedicated re-cost workflow exists,
  -- refuse the decrease rather than oversubscribe the garden.
  IF p_payload ? 'outside_table_capacity' THEN
    IF (p_payload -> 'outside_table_capacity' ->> 'value')::numeric
       < public.get_setting_int('outside_table_capacity', 8) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Lowering the seats per outside table needs the re-costing workflow, because bookings already taken were costed at the old capacity. Increases are fine.');
    END IF;
  END IF;

  SELECT COALESCE(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    INTO v_old
    FROM public.system_settings s
   WHERE s.key = ANY (public.table_booking_settings_keys(p_section));

  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    INSERT INTO public.system_settings (key, value)
    VALUES (v_key, p_payload -> v_key)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now();
  END LOOP;

  UPDATE public.settings_revisions
     SET revision = revision + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE section = p_section
  RETURNING revision INTO v_new_rev;

  INSERT INTO public.audit_logs
    (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values)
  VALUES
    (p_actor_id, 'update', 'table_booking_settings', p_section, 'success', v_old, p_payload);

  RETURN jsonb_build_object('ok', true, 'revision', v_new_rev);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Trusted backend only. The AMS route proves authority before calling.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_table_booking_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_table_booking_settings(text, jsonb, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_table_booking_settings(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.table_booking_settings_keys(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_table_booking_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_table_booking_settings(text, jsonb, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_table_booking_settings(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_booking_settings_keys(text) TO service_role;

REVOKE ALL ON FUNCTION public.table_booking_setting_type(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_setting_int(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_setting_bool(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_booking_setting_type(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_setting_int(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_setting_bool(text, boolean) TO service_role;

COMMIT;
