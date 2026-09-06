CREATE OR REPLACE FUNCTION public.move_table_booking_time_v06(p_table_booking_id uuid, p_booking_time time without time zone, p_start_datetime timestamp with time zone, p_booking_end_datetime timestamp with time zone, p_assignment_end_datetime timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated_booking uuid;
  v_assignment_count integer := 0;
  v_high_chairs_requested integer;
  v_high_chairs_granted integer;
  v_old_booking_time time;
  v_old_start timestamptz;
  v_old_booking_end timestamptz;
BEGIN
  IF p_booking_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_booking_window'
      USING ERRCODE = '22023',
            DETAIL = 'booking end must be after start';
  END IF;

  -- The table is held for at least as long as the guest has it. A shorter occupancy window would
  -- release the table while the party is still sitting at it.
  IF p_assignment_end_datetime < p_booking_end_datetime THEN
    RAISE EXCEPTION 'invalid_occupancy_window'
      USING ERRCODE = '22023',
            DETAIL = 'assignment end must not be before booking end';
  END IF;

  -- Read the pre-move state under the same transaction so the caller can audit true old values
  -- without a second round trip that a concurrent write could invalidate.
  SELECT booking_time, start_datetime, end_datetime, COALESCE(high_chair_count, 0)
    INTO v_old_booking_time, v_old_start, v_old_booking_end, v_high_chairs_requested
  FROM public.table_bookings
  WHERE id = p_table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT COUNT(*)
    INTO v_assignment_count
  FROM public.booking_table_assignments
  WHERE table_booking_id = p_table_booking_id;

  -- The occupancy window, gap included, goes to the assignments. The overlap trigger on this
  -- table is what rejects a clash, so this statement is the one that can raise 23P01.
  IF v_assignment_count > 0 THEN
    UPDATE public.booking_table_assignments
       SET start_datetime = p_start_datetime,
           end_datetime   = p_assignment_end_datetime
     WHERE table_booking_id = p_table_booking_id;

    GET DIAGNOSTICS v_assignment_count = ROW_COUNT;
  END IF;

  -- The guest window, gap excluded, goes to the booking.
  UPDATE public.table_bookings
     SET booking_time   = p_booking_time,
         start_datetime = p_start_datetime,
         end_datetime   = p_booking_end_datetime,
         updated_at     = now()
   WHERE id = p_table_booking_id
   RETURNING id INTO v_updated_booking;

  IF v_updated_booking IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  -- Re-grant over the guest window, because that is the window high chair contention is measured
  -- on. Never blocks the move; a reduction is reported instead.
  v_high_chairs_granted := public.reserve_high_chairs(
    p_table_booking_id, v_high_chairs_requested, p_start_datetime, p_booking_end_datetime
  );

  RETURN jsonb_build_object(
    'state', 'updated',
    'assignment_count', v_assignment_count,
    'old_booking_time', v_old_booking_time,
    'old_start_datetime', v_old_start,
    'old_end_datetime', v_old_booking_end,
    'high_chairs_requested', v_high_chairs_requested,
    'high_chairs_granted', v_high_chairs_granted
  );
END;
$function$;
