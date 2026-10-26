-- Christmas party numbers can change in the final week, and the guest who leaves is the one whose
-- dishes go (BK-054, customer bookings review of 24 October 2026; owner decision D21).
--
-- From noon seven days before the date, assert_christmas_course_snapshot_v01 refused ANY change to
-- the course list once a guest on 2 or 3 courses remained, so "two can't make it" and "one more on
-- 1 course" could not be recorded in the busiest weeks. Its dish clean-up also matched seats by
-- position, so the only way to shrink a party was to drop the last seat, and the dishes of everyone
-- after a guest who left would have moved onto the wrong person.
--
-- Three changes, nothing else:
--
-- 1. assert_christmas_course_snapshot_v01. After the deadline the kitchen's order may shrink but not
--    grow: a change is refused only when more guests are on 2 or more courses than before, or more on
--    3. A guest leaving, a guest added on 1 course and a guest moving down all go through; a guest
--    moving up or added on 2 or 3 is still refused, as is moving a booking with 2 or 3 course guests
--    to a date past its deadline, and recording tiers for the first time after it. The trigger cannot
--    tell which seat left, so it judges the whole party; change_christmas_party_v01 below, which does
--    know, refuses a particular guest moving up, and so does the application
--    (src/lib/events/staff-seat-updates.ts). The dish clean-up now keeps a seat's dishes
--    while they fit its tier and clears them when they do not, instead of clearing any seat whose
--    position changed. A seat above the new party size is left for preorder_sync_covers, which reports
--    what it removes.
-- 2. change_christmas_party_v01 (new). Removes the guests staff or the booker picked, with their
--    seats and dishes, closes up the seat numbers of the guests who stay, and saves the new party size
--    and course list, in one transaction. Service role only, like every other Christmas routine.
-- 3. booking_preorder_covers_touch_updated_at now fires on a change to a seat's name or dietary note
--    only. Closing up seat numbers is not a change to the seat, and the kitchen sheet marks a seat
--    whose details changed after the cutoff (BK-051), so renumbering must not mark every guest after
--    the one who left.
--
-- The function bodies restate production exactly apart from those rules: SECURITY INVOKER,
-- search_path public, pg_catalog, and EXECUTE for service_role only (checked against production on
-- 26 October 2026; assert_christmas_course_snapshot_v01 md5(prosrc) 9a9b32e9948155f0a945ec020984f536,
-- the same text as 20260905124506_christmas_course_snapshot). Rollback:
-- tasks/christmas-party-size-changes/rollback.sql. Tested by
-- scripts/testing/christmas-party-size-changes-postgres.py.

CREATE OR REPLACE FUNCTION public.assert_christmas_course_snapshot_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE v_requires boolean;
BEGIN
  IF NEW.christmas_course_counts IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL THEN
      RAISE EXCEPTION 'Christmas course choices cannot be cleared.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF cardinality(NEW.christmas_course_counts) <> NEW.party_size
     OR array_ndims(NEW.christmas_course_counts) <> 1
     OR array_lower(NEW.christmas_course_counts, 1) <> 1
     OR EXISTS (SELECT 1 FROM unnest(NEW.christmas_course_counts) c WHERE c IS NULL OR c NOT BETWEEN 1 AND 3) THEN
    RAISE EXCEPTION 'Christmas bookings need a course choice for every guest when changing the party size.' USING ERRCODE = '22023';
  END IF;
  IF NEW.booking_type::text <> 'christmas' OR NEW.booking_period_answer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Christmas course choices must remain attached to a Christmas booking.' USING ERRCODE = '22023';
  END IF;
  v_requires := EXISTS (SELECT 1 FROM unnest(NEW.christmas_course_counts) c WHERE c > 1);
  NEW.booking_period_requires_preorder := v_requires;
  IF TG_OP = 'UPDATE' AND v_requires AND (
      NEW.booking_date IS DISTINCT FROM OLD.booking_date
      OR OLD.christmas_course_counts IS NULL
      -- After the deadline the kitchen's order may shrink but not grow.
      OR (SELECT count(*) FROM unnest(NEW.christmas_course_counts) c WHERE c >= 2)
         > (SELECT count(*) FROM unnest(OLD.christmas_course_counts) c WHERE c >= 2)
      OR (SELECT count(*) FROM unnest(NEW.christmas_course_counts) c WHERE c = 3)
         > (SELECT count(*) FROM unnest(OLD.christmas_course_counts) c WHERE c = 3)
    ) AND (public.christmas_course_policy_v01(NEW.booking_date)->>'multiple_courses_available')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Christmas pre-order deadline has passed for that date.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL
     AND NEW.christmas_course_counts IS DISTINCT FROM OLD.christmas_course_counts THEN
    -- A seat keeps its dishes while they fit its tier: nothing on 1 course, a main and one other on
    -- 2. Judged on the seat as it now stands, because change_christmas_party_v01 has already closed
    -- up the seat numbers when a guest left. This runs in the same transaction as the amendment, so
    -- a later failure restores both the course list and the dishes.
    DELETE FROM public.booking_preorder_selections s USING public.booking_preorder_covers c
      WHERE s.cover_id = c.id AND c.table_booking_id = NEW.id
        AND c.ordinal <= cardinality(NEW.christmas_course_counts)
        AND (NEW.christmas_course_counts[c.ordinal] = 1
          OR (SELECT count(*) FROM public.booking_preorder_selections x
               WHERE x.cover_id = c.id AND x.course IN ('starter', 'dessert'))
             > NEW.christmas_course_counts[c.ordinal] - 1);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_christmas_course_snapshot_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_course_snapshot_v01() TO service_role;

-- p_course_counts is the whole new party in seat order: the guests who stay first, in their old
-- order, then anyone added. p_removed_ordinals names the leaving guests by their current seat number.
CREATE FUNCTION public.change_christmas_party_v01(
  p_booking_id uuid,
  p_course_counts integer[],
  p_removed_ordinals integer[] DEFAULT '{}'::integer[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE
  v_old integer[];
  v_date date;
  v_removed integer[] := coalesce(p_removed_ordinals, '{}'::integer[]);
  v_dropped jsonb := '[]'::jsonb;
  v_row public.table_bookings;
BEGIN
  SELECT b.christmas_course_counts, b.booking_date INTO v_old, v_date
    FROM public.table_bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_course_counts IS NULL OR cardinality(p_course_counts) = 0 THEN
    RAISE EXCEPTION 'Christmas bookings need a course choice for every guest when changing the party size.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_removed) > 0 AND (
       v_old IS NULL
       OR EXISTS (SELECT 1 FROM unnest(v_removed) r WHERE r IS NULL OR r NOT BETWEEN 1 AND cardinality(v_old))
       OR (SELECT count(DISTINCT r) FROM unnest(v_removed) r) <> cardinality(v_removed)
       OR cardinality(p_course_counts) < cardinality(v_old) - cardinality(v_removed)
     ) THEN
    RAISE EXCEPTION 'Choose the guests who are leaving from the guests on this booking.' USING ERRCODE = '22023';
  END IF;

  -- After the deadline, guest by guest, which the trigger cannot do: nobody who stays moves up, and
  -- nobody joins on more than 1 course. The trigger still checks the party as a whole.
  IF v_old IS NOT NULL
     AND (public.christmas_course_policy_v01(v_date)->>'multiple_courses_available')::boolean IS DISTINCT FROM true
     AND (
       EXISTS (
         SELECT 1
           FROM (SELECT u.tier, row_number() OVER (ORDER BY u.seat) AS kept_seat
                   FROM unnest(v_old) WITH ORDINALITY AS u(tier, seat)
                  WHERE NOT (u.seat = ANY (v_removed))) kept
          WHERE p_course_counts[kept.kept_seat] > kept.tier)
       OR EXISTS (
         SELECT 1 FROM unnest(p_course_counts) WITH ORDINALITY AS n(tier, seat)
          WHERE n.seat > cardinality(v_old) - cardinality(v_removed) AND n.tier > 1)
     ) THEN
    RAISE EXCEPTION 'Christmas pre-order deadline has passed for that date.' USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_removed) > 0 THEN
    -- What the leaving guests had chosen, captured before their seats go, so staff can tell the booker.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'ordinal', c.ordinal, 'guest_name', c.guest_name,
             'courses', coalesce((SELECT jsonb_agg(jsonb_build_object('course', s.course, 'item_name', s.item_name) ORDER BY s.course)
                                   FROM public.booking_preorder_selections s WHERE s.cover_id = c.id), '[]'::jsonb)
           ) ORDER BY c.ordinal), '[]'::jsonb)
      INTO v_dropped
      FROM public.booking_preorder_covers c
     WHERE c.table_booking_id = p_booking_id AND c.ordinal = ANY (v_removed);

    DELETE FROM public.booking_preorder_covers
     WHERE table_booking_id = p_booking_id AND ordinal = ANY (v_removed);

    -- The guests who stay close up in order. Two steps, because (table_booking_id, ordinal) is
    -- unique and not deferrable; a party is never above 20, so 1000 is clear of every real seat.
    UPDATE public.booking_preorder_covers SET ordinal = ordinal + 1000
     WHERE table_booking_id = p_booking_id AND ordinal > (SELECT min(r) FROM unnest(v_removed) r);
    UPDATE public.booking_preorder_covers c
       SET ordinal = (c.ordinal - 1000) - (SELECT count(*) FROM unnest(v_removed) r WHERE r < c.ordinal - 1000)
     WHERE c.table_booking_id = p_booking_id AND c.ordinal > 1000;
  END IF;

  -- The trigger above checks the new list and the deadline, and clears dishes a seat no longer has.
  UPDATE public.table_bookings
     SET party_size = cardinality(p_course_counts),
         committed_party_size = cardinality(p_course_counts),
         christmas_course_counts = p_course_counts,
         updated_at = now()
   WHERE id = p_booking_id
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'party_size', v_row.party_size,
    'committed_party_size', v_row.committed_party_size,
    'updated_at', v_row.updated_at,
    'removed', v_dropped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[]) TO service_role;

DROP TRIGGER booking_preorder_covers_touch_updated_at ON public.booking_preorder_covers;
CREATE TRIGGER booking_preorder_covers_touch_updated_at
BEFORE UPDATE OF guest_name, dietary_note ON public.booking_preorder_covers
FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();
