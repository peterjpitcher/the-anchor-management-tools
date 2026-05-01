-- Move a table booking and all of its table assignments in one transaction.
-- This is used by the FOH drag-to-time endpoint so the booking row cannot move
-- while its table assignment remains behind if assignment integrity checks fail.

CREATE OR REPLACE FUNCTION public.move_table_booking_time_v05(
  p_table_booking_id uuid,
  p_booking_time time,
  p_start_datetime timestamptz,
  p_end_datetime timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_booking uuid;
  v_assignment_count integer := 0;
BEGIN
  IF p_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_booking_window'
      USING ERRCODE = '22023',
            DETAIL = 'end_datetime must be after start_datetime';
  END IF;

  SELECT COUNT(*)
    INTO v_assignment_count
  FROM public.booking_table_assignments
  WHERE table_booking_id = p_table_booking_id;

  IF v_assignment_count > 0 THEN
    UPDATE public.booking_table_assignments
       SET start_datetime = p_start_datetime,
           end_datetime = p_end_datetime
     WHERE table_booking_id = p_table_booking_id;

    GET DIAGNOSTICS v_assignment_count = ROW_COUNT;
  END IF;

  UPDATE public.table_bookings
     SET booking_time = p_booking_time,
         start_datetime = p_start_datetime,
         end_datetime = p_end_datetime,
         updated_at = now()
   WHERE id = p_table_booking_id
   RETURNING id INTO v_updated_booking;

  IF v_updated_booking IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'assignment_count', v_assignment_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_table_booking_time_v05(uuid, time, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_table_booking_time_v05(uuid, time, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_table_booking_time_v05(uuid, time, timestamptz, timestamptz) TO service_role;
