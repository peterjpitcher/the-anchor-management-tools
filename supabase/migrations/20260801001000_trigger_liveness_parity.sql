-- Table prioritisation, review finding F8.
--
-- The picker and the enforcement trigger disagree about what "still occupying a table" means.
--
--   find_table_allocation_candidates uses is_booking_live, which releases an expired UNPAID
--   deposit hold.
--
--   enforce_booking_table_assignment_integrity_v05 uses only
--       status NOT IN ('cancelled','no_show') AND left_at IS NULL
--   with no hold-expiry term at all, so it still considers that booking active.
--
-- So the picker offers a table, the insert then raises 23P01 table_assignment_overlap, and the
-- booking fails outright instead of falling through to the next table. That is the same shape as
-- the private-booking regression this whole project exists to fix, one layer down.
--
-- This is the only migration in the set that changes behaviour of something already running in
-- production, so it is deliberately last and deliberately narrow: ONE predicate is replaced. Every
-- other branch is carried over byte for byte from the live definition captured on 2026-07-27
-- (md5 955c30781f281014bd670cec42e7eaa8, see tasks/artefacts/2026-07-27/baseline.md).

BEGIN;

-- ---------------------------------------------------------------------------
-- Drift guard. Refuse to run if production has moved since this was written.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_md5      text;
  v_def      text;
  v_expected text := '955c30781f281014bd670cec42e7eaa8';
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'enforce_booking_table_assignment_integrity_v05';

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'enforce_booking_table_assignment_integrity_v05';

  IF v_md5 IS NULL THEN
    RAISE NOTICE 'enforce_booking_table_assignment_integrity_v05 is absent; nothing to drift from.';
  ELSIF v_def NOT LIKE '%table_assignment_overlap%' THEN
    -- A placeholder rather than the real thing, which is how the test harness attaches the
    -- trigger before the body exists. Guarding against drift of something that was never the
    -- real function would just be noise.
    RAISE NOTICE 'Existing function is a placeholder, not the production trigger; installing fresh.';
  ELSIF v_md5 <> v_expected THEN
    RAISE EXCEPTION USING
      MESSAGE = 'enforce_booking_table_assignment_integrity_v05 has changed since this migration was written.',
      DETAIL  = format('Expected %s, found %s.', v_expected, v_md5),
      HINT    = 'Re-derive this migration from the current live definition before applying it.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- The trigger, with exactly one predicate changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_table_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tables t
    WHERE t.id = NEW.table_id
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'table_not_found'
      USING ERRCODE = '23503';
  END IF;

  -- The only mutual exclusion in the whole flow. Kept exactly as it was.
  PERFORM 1
  FROM public.tables t
  WHERE t.id = NEW.table_id
  FOR UPDATE;

  IF public.is_table_blocked_by_private_booking_v05(
    NEW.table_id,
    NEW.start_datetime,
    NEW.end_datetime,
    NULL
  ) THEN
    RAISE EXCEPTION 'table_assignment_private_blocked'
      USING ERRCODE = '23P01',
            DETAIL = 'table is blocked by an overlapping private booking window';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      -- THE CHANGE. Was:
      --   tb.status NOT IN ('cancelled','no_show') AND tb.left_at IS NULL
      -- which held a table for an expired UNPAID deposit hold that the picker had
      -- already released. Selection and enforcement now share one definition, so the
      -- picker can no longer offer a table the trigger will refuse.
      AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
      AND (TG_OP <> 'UPDATE' OR bta.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping active assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_communal_seat_allocations ecsa
    JOIN public.bookings b ON b.id = ecsa.event_booking_id
    WHERE ecsa.table_id = NEW.table_id
      AND ecsa.start_datetime < NEW.end_datetime
      AND ecsa.end_datetime > NEW.start_datetime
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
  ) THEN
    RAISE EXCEPTION 'table_assignment_communal_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has communal seated guests for this window';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_booking_table_assignment_integrity_v05 IS
  'Assignment integrity. Shares is_booking_live with the allocator, so selection and enforcement can never disagree about whether a table is free.';

-- Reproduce the live ACL exactly: service_role only.
REVOKE ALL ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() TO service_role;

COMMIT;
