-- Allow normal table assignments to share a table with communal event seating
-- while the communal allocations have not consumed the full table capacity.

CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_capacity integer;
  v_communal_reserved integer := 0;
BEGIN
  SELECT COALESCE(t.capacity, 0)::integer
  INTO v_table_capacity
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

  SELECT COALESCE(SUM(GREATEST(COALESCE(ecsa.seats, 0), 0)), 0)::integer
  INTO v_communal_reserved
  FROM public.event_communal_seat_allocations ecsa
  JOIN public.bookings b ON b.id = ecsa.event_booking_id
  WHERE ecsa.table_id = NEW.table_id
    AND ecsa.start_datetime < NEW.end_datetime
    AND ecsa.end_datetime > NEW.start_datetime
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

  IF v_table_capacity > 0 AND v_communal_reserved >= v_table_capacity THEN
    RAISE EXCEPTION 'table_assignment_communal_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table has no remaining capacity after communal seated guests';
  END IF;

  RETURN NEW;
END;
$$;
