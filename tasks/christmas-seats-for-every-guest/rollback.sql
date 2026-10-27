-- Rollback for 20261026192817_christmas_seats_for_every_guest.sql. Restores preorder_sync_covers
-- exactly as production held it on 26 October 2026 (body from 20260804000100_seasonal_preorders,
-- md5(prosrc) f225b098125e5e11ca54a432c1142e28), with its grants. Seats already made for 1 course
-- guests stay; the old function keeps existing seats in step and never removes them for that reason.

CREATE OR REPLACE FUNCTION public.preorder_sync_covers(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER   -- must write tables that are service-role-only under RLS
SET search_path = public
AS $$
DECLARE
  v_booking   public.table_bookings;
  v_wanted    integer;
  v_removed   jsonb := '[]'::jsonb;
  v_added     integer := 0;
  v_count     integer;
BEGIN
  SELECT * INTO v_booking FROM public.table_bookings WHERE id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'booking_not_found');
  END IF;

  -- Covers are wanted when the booking's own snapshot says the guest accepted a seasonal offer that
  -- requires a pre-order. The snapshot is read, not the period row, because a manager may have
  -- edited or archived the period since, and that must not change a booking already taken.
  IF COALESCE(v_booking.booking_period_requires_preorder, false)
     AND COALESCE(v_booking.booking_period_answer, false) THEN
    v_wanted := v_booking.party_size;
  ELSE
    -- Not a pre-order booking. Keep whatever covers already exist in step (someone may have taken
    -- the order before the answer changed), but never create the first one.
    SELECT count(*) INTO v_count
      FROM public.booking_preorder_covers WHERE table_booking_id = p_booking_id;
    v_wanted := CASE WHEN v_count > 0 THEN v_booking.party_size ELSE 0 END;
  END IF;

  -- Capture the doomed rows and their choices BEFORE the delete, because the selections cascade away
  -- with the cover and the caller needs to be able to say "seat 6, Dave, who was having the turkey".
  SELECT COALESCE(jsonb_agg(dropped ORDER BY (dropped ->> 'ordinal')::integer), '[]'::jsonb)
    INTO v_removed
  FROM (
    SELECT jsonb_build_object(
             'id', c.id,
             'ordinal', c.ordinal,
             'guest_name', c.guest_name,
             'courses', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('course', s.course, 'item_name', s.item_name)
                                ORDER BY s.course)
                 FROM public.booking_preorder_selections s
                WHERE s.cover_id = c.id
             ), '[]'::jsonb)
           ) AS dropped
      FROM public.booking_preorder_covers c
     WHERE c.table_booking_id = p_booking_id
       AND c.ordinal > v_wanted
  ) doomed;

  -- Deleting everything above the wanted count IS "highest ordinals first", and it also cleans up
  -- any ordinal left stranded above the range by an older write.
  DELETE FROM public.booking_preorder_covers
   WHERE table_booking_id = p_booking_id
     AND ordinal > v_wanted;

  -- Fill the gaps rather than appending, so a party that shrinks and grows again reuses seat numbers
  -- instead of climbing forever.
  INSERT INTO public.booking_preorder_covers (table_booking_id, ordinal)
  SELECT p_booking_id, g
    FROM generate_series(1, GREATEST(v_wanted, 0)) g
   WHERE NOT EXISTS (
     SELECT 1 FROM public.booking_preorder_covers c
      WHERE c.table_booking_id = p_booking_id AND c.ordinal = g
   );
  GET DIAGNOSTICS v_added = ROW_COUNT;

  SELECT count(*) INTO v_count
    FROM public.booking_preorder_covers WHERE table_booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'party_size', v_booking.party_size,
    'cover_count', v_count,
    'added', v_added,
    'removed', v_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preorder_sync_covers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preorder_sync_covers(uuid) TO service_role;
