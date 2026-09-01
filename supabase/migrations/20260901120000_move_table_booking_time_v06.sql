-- Moving a booking's time must not lengthen the guest's booking by the turnaround gap.
--
-- WHAT IS WRONG
--
-- Since turn times were switched on, a booking carries TWO windows on purpose:
--
--   table_bookings.start/end_datetime          the time quoted to the guest
--   booking_table_assignments.start/end        the same window PLUS turnaround_gap_minutes,
--                                              because the table is held longer than the guest sits
--
-- `create_table_booking_core_v06` writes them separately and correctly. `move_table_booking_time_v05`
-- collapses them: it is handed ONE end time, and writes that same value to the assignment rows and
-- to the booking row. The caller derives that end from the assignment window, so a 105 minute guest
-- booking with a 15 minute gap comes back as a 120 minute booking row while duration_minutes still
-- says 105.
--
-- The damage is not only cosmetic. `count_high_chairs_in_window` overlaps on the BOOKING window, so
-- an inflated booking row makes a party contend for high chairs for 15 minutes it is not there, and
-- availability, reporting and the guest's own manage page all read the same inflated end.
--
-- WHY NOTHING IS BROKEN YET
--
-- v05's only caller is the FOH drag-to-move path, which is disabled on the kiosk account the floor
-- actually uses and needs a touch-action fix to work on any tablet. Checked on production: no live
-- booking carries the +15 signature. The defect is dormant, and this migration lands before the tap
-- UI that would make it fire on every use.
--
-- THE FIX
--
-- v06 takes the two end times as separate arguments and writes each to its own place. High chairs
-- are re-granted over the GUEST window, matching count_high_chairs_in_window, rather than the
-- occupancy window v05 used (which over-counted by the gap). The granted count comes back in the
-- result so the caller can tell staff when a chair was lost to the move.
--
-- Outside reservations need no work here: table_bookings_sync_outside_reservation already fires on
-- AFTER UPDATE OF start_datetime, end_datetime, so re-windowing the booking row reconciles the
-- garden hold on its own.
--
-- Additive. v05 is left in place and untouched so this migration can be applied before the code
-- that calls v06 is deployed. It has no caller once that deploy lands and can be dropped later.

BEGIN;

CREATE OR REPLACE FUNCTION public.move_table_booking_time_v06(
  p_table_booking_id uuid,
  p_booking_time time,
  p_start_datetime timestamptz,
  p_booking_end_datetime timestamptz,
  p_assignment_end_datetime timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.move_table_booking_time_v06 IS
  'Re-times a table booking, keeping the guest window and the table occupancy window distinct. Supersedes move_table_booking_time_v05, which wrote one end time to both and so absorbed turnaround_gap_minutes into the guest booking.';

-- Same lockdown as every other SECURITY DEFINER routine here: service_role only, never anon or
-- authenticated. The FOH route reaches it through the admin client after its own permission check.
REVOKE ALL ON FUNCTION public.move_table_booking_time_v06(uuid, time, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_table_booking_time_v06(uuid, time, timestamptz, timestamptz, timestamptz) TO service_role;

COMMIT;
