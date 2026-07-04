-- Atomic multi-table move for table bookings (TP-03).
--
-- moveBookingAssignmentToTables previously issued a per-table loop of separate
-- UPDATE/INSERT statements followed by a DELETE of stale assignments. A mid-loop
-- failure on a 2-4 table combo left the booking holding old + partial new tables,
-- over-blocking availability until a retry self-healed.
--
-- This RPC performs the whole move in one transaction:
--   1. delete assignments no longer wanted (frees their tables within the txn),
--   2. re-window retained assignments,
--   3. insert the missing target assignments.
-- Steps 2 and 3 fire the BEFORE INSERT/UPDATE trigger
-- enforce_booking_table_assignment_integrity_v05, so conflicts raise the exact
-- same errors the direct writes produced (table_assignment_overlap /
-- table_assignment_private_blocked / table_assignment_communal_overlap, all
-- ERRCODE 23P01) and roll the whole move back.
--
-- Additive only: no existing objects are dropped or altered.

CREATE OR REPLACE FUNCTION public.move_table_booking_assignments_v05(
  p_table_booking_id uuid,
  p_table_ids uuid[],
  p_start_datetime timestamptz,
  p_end_datetime timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_ids uuid[];
  v_now timestamptz := now();
BEGIN
  IF p_table_booking_id IS NULL
     OR p_start_datetime IS NULL
     OR p_end_datetime IS NULL
     OR p_end_datetime <= p_start_datetime THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_window');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT target.table_id
    FROM unnest(COALESCE(p_table_ids, ARRAY[]::uuid[])) AS target(table_id)
    WHERE target.table_id IS NOT NULL
  )
  INTO v_target_ids;

  IF v_target_ids IS NULL OR cardinality(v_target_ids) = 0 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_target_tables');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.table_bookings tb WHERE tb.id = p_table_booking_id
  ) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  -- 1. Remove assignments that are no longer wanted first so their tables free
  -- up within this transaction before the trigger re-validates the new rows.
  DELETE FROM public.booking_table_assignments
  WHERE table_booking_id = p_table_booking_id
    AND NOT (table_id = ANY (v_target_ids));

  -- 2. Re-window retained assignments (fires the integrity trigger per row).
  UPDATE public.booking_table_assignments
  SET start_datetime = p_start_datetime,
      end_datetime = p_end_datetime
  WHERE table_booking_id = p_table_booking_id
    AND table_id = ANY (v_target_ids)
    AND (
      start_datetime IS DISTINCT FROM p_start_datetime
      OR end_datetime IS DISTINCT FROM p_end_datetime
    );

  -- 3. Insert the missing target assignments (fires the integrity trigger).
  INSERT INTO public.booking_table_assignments (
    table_booking_id,
    table_id,
    start_datetime,
    end_datetime,
    created_at
  )
  SELECT
    p_table_booking_id,
    target.table_id,
    p_start_datetime,
    p_end_datetime,
    v_now
  FROM unnest(v_target_ids) AS target(table_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    WHERE bta.table_booking_id = p_table_booking_id
      AND bta.table_id = target.table_id
  );

  RETURN jsonb_build_object(
    'state', 'moved',
    'table_booking_id', p_table_booking_id,
    'table_ids', to_jsonb(v_target_ids)
  );
END;
$$;

-- Lock down execution: staff sessions (authenticated) and system paths
-- (service_role) only. New public functions default to EXECUTE for anon too,
-- so revoke it explicitly.
REVOKE ALL ON FUNCTION public.move_table_booking_assignments_v05(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_table_booking_assignments_v05(uuid, uuid[], timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_table_booking_assignments_v05(uuid, uuid[], timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_table_booking_assignments_v05(uuid, uuid[], timestamptz, timestamptz) TO service_role;
