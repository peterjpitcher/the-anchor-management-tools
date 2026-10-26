-- Rollback for 20261026190515_christmas_party_size_changes.sql. Restores production exactly as it
-- stood on 26 October 2026: assert_christmas_course_snapshot_v01 as written in
-- 20260905124506_christmas_course_snapshot (md5(prosrc) 9a9b32e9948155f0a945ec020984f536), no
-- change_christmas_party_v01, and the seat touch trigger firing on every update.
--
-- Run it only with the application code from before the release, or with that code's Christmas
-- party changes switched off: the new code calls change_christmas_party_v01.

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
  IF TG_OP = 'UPDATE' AND (
      NEW.booking_date IS DISTINCT FROM OLD.booking_date
      OR NEW.christmas_course_counts IS DISTINCT FROM OLD.christmas_course_counts
    ) AND v_requires AND (public.christmas_course_policy_v01(NEW.booking_date)->>'multiple_courses_available')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Christmas pre-order deadline has passed for that date.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL
     AND NEW.christmas_course_counts IS DISTINCT FROM OLD.christmas_course_counts THEN
    -- A changed tier invalidates that seat's old dishes. This runs in the same transaction
    -- as the explicit staff amendment, so a later failure restores both snapshot and dishes.
    DELETE FROM public.booking_preorder_selections s USING public.booking_preorder_covers c
      WHERE s.cover_id = c.id AND c.table_booking_id = NEW.id
        AND NEW.christmas_course_counts[c.ordinal] IS DISTINCT FROM OLD.christmas_course_counts[c.ordinal];
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_christmas_course_snapshot_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_course_snapshot_v01() TO service_role;

DROP FUNCTION IF EXISTS public.change_christmas_party_v01(uuid, integer[], integer[]);

DROP TRIGGER IF EXISTS booking_preorder_covers_touch_updated_at ON public.booking_preorder_covers;
CREATE TRIGGER booking_preorder_covers_touch_updated_at
BEFORE UPDATE ON public.booking_preorder_covers
FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();
