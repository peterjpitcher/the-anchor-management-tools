-- Table prioritisation: close the grants the previous migrations left open.
--
-- WHAT WENT WRONG
--
-- Every migration in this set ended with `REVOKE ALL ON FUNCTION ... FROM PUBLIC` followed by a
-- GRANT to service_role, which reads as "service_role only". It is not.
--
-- Supabase configures ALTER DEFAULT PRIVILEGES so that a newly created function in `public` is
-- granted EXECUTE to `anon` and `authenticated` BY NAME. `REVOKE ... FROM PUBLIC` removes the
-- PUBLIC pseudo-role only; it does not touch a grant made to a named role. So all twenty new
-- functions went to production executable by anonymous callers.
--
-- The worst of them was `set_table_booking_settings`: SECURITY DEFINER, writes settings and an
-- audit row, and was reachable by anyone with the anon key. Setting the kitchen pace to zero
-- would have stopped every online booking. `create_table_booking_staff_v06` was also exposed,
-- which defeats the entire point of splitting it from the public entry point.
--
-- This was already a documented trap in the project notes. It was not applied.
--
-- Production was repaired immediately by running the equivalent REVOKEs directly. This migration
-- records the same change so the repository matches production and a rebuild cannot reopen it.
--
-- THE RULE, for anything added here later: a new function in `public` is exposed by default.
-- REVOKE FROM PUBLIC is not enough. Always revoke from `anon, authenticated` explicitly and
-- verify with pg_proc.proacl afterwards.

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        -- The allocator and everything it is built from.
        'find_table_allocation_candidates',
        'tables_are_connected',
        'table_is_held',
        'table_names_in_order',
        'is_booking_live',
        'windows_overlap',
        -- Availability, and the mapping that keeps internal reasons internal.
        'check_table_availability_v06',
        'public_booking_reason',
        'public_booking_message',
        -- Booking. The PUBLIC entry point is deliberately absent from this list; see below.
        'create_table_booking_core_v06',
        'create_table_booking_staff_v06',
        -- Events.
        'allocate_event_communal_seats_v02',
        -- Settings. set_table_booking_settings is the one that could have stopped all bookings.
        'get_setting_int',
        'get_setting_bool',
        'get_table_booking_settings',
        'set_table_booking_settings',
        'validate_table_booking_settings',
        'table_booking_settings_keys',
        'table_booking_setting_type'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
  END LOOP;
END;
$$;

-- create_table_booking_public_v06 KEEPS its anon and authenticated grants, deliberately.
--
-- It reproduces the ACL of the v05 function it replaces, so an existing caller cannot break
-- during the changeover. It is also safe to expose by construction: it takes no channel, no pin
-- and no overrides, it cannot bypass the cut-off or pacing whatever it is passed, and its party
-- ceiling is the online one. That is precisely why the public and staff entry points were split.
--
-- The v05 anon grant is a pre-existing exposure noted in tasks/artefacts/2026-07-27/baseline.md
-- and is a candidate for a separate hardening pass, once it is known whether any caller relies
-- on it.

-- ---------------------------------------------------------------------------
-- Prove it. This migration fails rather than reporting success on a half-closed door.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leaky text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_leaky
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'find_table_allocation_candidates','check_table_availability_v06','create_table_booking_core_v06',
      'create_table_booking_staff_v06','is_booking_live','windows_overlap','tables_are_connected',
      'table_is_held','table_names_in_order','allocate_event_communal_seats_v02',
      'get_setting_int','get_setting_bool','get_table_booking_settings','set_table_booking_settings',
      'validate_table_booking_settings','table_booking_settings_keys','table_booking_setting_type',
      'public_booking_reason','public_booking_message')
    AND array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These functions are still executable by anon or authenticated.',
      DETAIL  = v_leaky,
      HINT    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  END IF;
END;
$$;

COMMIT;
