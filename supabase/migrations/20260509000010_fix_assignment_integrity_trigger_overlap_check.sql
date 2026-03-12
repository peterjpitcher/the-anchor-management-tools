-- Fix: broken overlap check in enforce_booking_table_assignment_integrity_v05 trigger.
--
-- Problem: this trigger fires BEFORE INSERT OR UPDATE on booking_table_assignments.
-- Its overlap guard at line 594 of 20260420000028 used:
--
--   AND tb.status <> 'cancelled'
--
-- This treats no_show bookings and bookings where guests have already departed
-- (left_at IS NOT NULL) as active occupants.  When create_table_booking_v05_core
-- inserts a new assignment row, the trigger fires, detects the stale no_show as
-- a conflict, and raises EXCEPTION 'table_assignment_overlap' (ERRCODE 23P01).
-- That exception rolls back the insert and propagates up the call stack where it
-- is caught by the EXCEPTION WHEN OTHERS handler in
-- create_event_table_reservation_v05, which returns {'state':'blocked','reason':'no_table'}.
--
-- This is why the FOH event booking returns "no_table" even after migrations
-- 20260509000008 and 20260509000009 fixed the overlap checks in the function
-- bodies — the trigger is the real gatekeeper that was still blocking.
--
-- Fix: mirror the corrected guard — exclude cancelled, no_show, and bookings
-- where the guest has already left (left_at IS NOT NULL).

CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_status public.table_booking_status;
BEGIN
  IF NEW.start_datetime IS NULL
     OR NEW.end_datetime IS NULL
     OR NEW.end_datetime <= NEW.start_datetime THEN
    RAISE EXCEPTION 'table_assignment_invalid_window'
      USING ERRCODE = '22023',
            DETAIL = 'end_datetime must be greater than start_datetime';
  END IF;

  SELECT tb.status
  INTO v_new_status
  FROM public.table_bookings tb
  WHERE tb.id = NEW.table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_booking_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF v_new_status = 'cancelled'::public.table_booking_status THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.tables t
  WHERE t.id = NEW.table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_found'
      USING ERRCODE = '23503';
  END IF;

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

  -- FIX: exclude no_show and already-departed bookings from conflict detection,
  -- consistent with the overlap guards in create_table_booking_v05_core_legacy
  -- (migration 20260509000008) and create_event_table_reservation_v05
  -- (migration 20260509000009).
  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
      AND tb.left_at IS NULL
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
      AND (TG_OP <> 'UPDATE' OR bta.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping active assignment';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged — just recreate to be safe.
DROP TRIGGER IF EXISTS trg_enforce_booking_table_assignment_integrity_v05 ON public.booking_table_assignments;
CREATE TRIGGER trg_enforce_booking_table_assignment_integrity_v05
  BEFORE INSERT OR UPDATE ON public.booking_table_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_table_assignment_integrity_v05();

REVOKE ALL ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() TO service_role;
