-- Fix: table assignment overlap check should not block tables where the guest has
-- departed or never arrived.
--
-- Previous behaviour: only 'cancelled' was excluded from the overlap check, so
-- 'no_show', 'completed', and bookings where the guest marked 'left' (left_at IS NOT NULL)
-- all continued to block the table even though it was physically empty.
--
-- Correct semantic: a booking occupies a table only when:
--   - status NOT IN ('cancelled', 'no_show')  — guest cancelled or never arrived
--   - left_at IS NULL                          — guest has not yet departed
--
-- Note: the 'completed' action always sets left_at, and the 'left' action also sets left_at,
-- so `left_at IS NULL` is sufficient to exclude both without needing to enumerate statuses.
--
-- This also extends the early-return guard (skip validation when the NEW assignment itself
-- belongs to a cancelled or no_show booking) to cover no_show consistently.

CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_status public.table_booking_status;
  v_new_left_at timestamptz;
BEGIN
  IF NEW.start_datetime IS NULL
     OR NEW.end_datetime IS NULL
     OR NEW.end_datetime <= NEW.start_datetime THEN
    RAISE EXCEPTION 'table_assignment_invalid_window'
      USING ERRCODE = '22023',
            DETAIL = 'end_datetime must be greater than start_datetime';
  END IF;

  SELECT tb.status, tb.left_at
  INTO v_new_status, v_new_left_at
  FROM public.table_bookings tb
  WHERE tb.id = NEW.table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_booking_not_found'
      USING ERRCODE = '23503';
  END IF;

  -- Skip overlap validation when assigning a table to a booking that is already
  -- closed (cancelled or no_show) or fully departed (left_at is set).
  -- These assignments are allowed but do not count as active occupancy.
  IF v_new_status IN (
       'cancelled'::public.table_booking_status,
       'no_show'::public.table_booking_status
     )
     OR v_new_left_at IS NOT NULL THEN
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

  -- A booking is actively occupying a table only when:
  --   status NOT IN ('cancelled', 'no_show')  →  guest cancelled or never arrived
  --   left_at IS NULL                          →  guest has not yet departed
  -- This correctly frees the table for no_show, completed, and left bookings.
  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      AND tb.status NOT IN (
            'cancelled'::public.table_booking_status,
            'no_show'::public.table_booking_status
          )
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

REVOKE ALL ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() TO service_role;
