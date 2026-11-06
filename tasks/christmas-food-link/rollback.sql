-- Rollback for supabase/migrations/20261106210000_christmas_food_link.sql. Restores production as it
-- stood on 6 November 2026, md5(prosrc): assert_christmas_course_snapshot_v01
-- ae3fa916c36cc8aafb8bbdd6c55bff6c and change_christmas_party_v01 92c12a21c38386e8d76805d81352faea
-- (both as written in 20261027132719_christmas_party_size_changes), assert_christmas_preorder_selection_v01
-- eff49973a4e4bad892dc3c706886bf24 (as written in 20260905124506_christmas_course_snapshot),
-- create_table_booking_staff_v06 da7e2723b287c7b738ea1d468a3d372d (patched in place by
-- 20261028125055_table_availability_rules_agree, restated here from pg_get_functiondef), no
-- set_christmas_seat_course_v01, and the tables, settings and menu rows as they were.
--
-- Run it only with the application code from before the release: the new code reads the new
-- columns and calls set_christmas_seat_course_v01.
--
-- What it does to rows written since the migration, because the old rules cannot hold them:
--   * a seat on 0 ("not chosen yet") becomes 1 course, the tier the old rules give a guest who has
--     chosen nothing; a main already chosen on such a seat stays until the next course change;
--   * preorder_guest links stop working and are deleted, and so are reminder ledger rows of the new
--     kinds (the old kinds are kept);
--   * the new seat columns (allergies, invite email, who saved) are dropped with what they hold.

-- Zeros first, while the new trigger (which accepts 0 and allows a move to 1) is still in place.
UPDATE public.table_bookings
   SET christmas_course_counts = array_replace(christmas_course_counts, 0, 1)
 WHERE 0 = ANY (christmas_course_counts);

-- Functions, exactly as production held them.

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

CREATE OR REPLACE FUNCTION public.assert_christmas_preorder_selection_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_preorder_covers c
      JOIN public.table_bookings b ON b.id=c.table_booking_id
      WHERE c.id=NEW.cover_id AND b.christmas_course_counts[c.ordinal]=1) THEN
    RAISE EXCEPTION 'One-course Christmas guests do not need a pre-order.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_christmas_party_v01(
  p_booking_id uuid,
  p_course_counts integer[],
  p_removed_ordinals integer[] DEFAULT '{}'::integer[],
  p_expected_course_counts integer[] DEFAULT NULL
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
  -- Two tabs removing "seat 2" from the same party would otherwise remove two different guests: the
  -- second request lands after the first has closed up the seat numbers. Refuse a change made against
  -- guests that have changed since, before anyone is removed. NULL skips the check.
  IF p_expected_course_counts IS NOT NULL AND (
       CASE WHEN cardinality(p_expected_course_counts) = 0 THEN v_old IS NOT NULL
            ELSE v_old IS DISTINCT FROM p_expected_course_counts END
     ) THEN
    RAISE EXCEPTION 'Christmas booking changed while you were editing it. Reload it and try again.' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.create_table_booking_staff_v06(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text DEFAULT 'food'::text, p_notes text DEFAULT NULL::text, p_sunday_lunch boolean DEFAULT false, p_source text DEFAULT 'admin'::text, p_bypass_cutoff boolean DEFAULT false, p_deposit_waived boolean DEFAULT false, p_bypass_pacing boolean DEFAULT false, p_high_chair_count integer DEFAULT 0, p_outside_seating boolean DEFAULT false, p_requires_accessible_table boolean DEFAULT false, p_channel text DEFAULT 'staff'::text, p_pin boolean DEFAULT false, p_overrides table_allocation_overrides DEFAULT NULL::table_allocation_overrides, p_actor_id uuid DEFAULT NULL::uuid, p_booking_period_id uuid DEFAULT NULL::uuid, p_booking_period_answer boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, p_booking_purpose,
    p_notes, p_sunday_lunch, p_source, p_bypass_cutoff, p_deposit_waived, p_bypass_pacing,
    p_high_chair_count, p_outside_seating, p_requires_accessible_table,
    COALESCE(NULLIF(p_channel, 'online'), 'staff'),   -- staff entry cannot masquerade as online
    p_pin,
    -- One party limit for every channel (owner decision D30, BK-146).
    public.get_setting_int('table_booking_max_party_online', 20),
    p_overrides, p_actor_id,
    p_booking_period_id, p_booking_period_answer
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_christmas_course_snapshot_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_course_snapshot_v01() TO service_role;
REVOKE ALL ON FUNCTION public.assert_christmas_preorder_selection_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_preorder_selection_v01() TO service_role;
REVOKE ALL ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[], integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[], integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.create_table_booking_staff_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, text, boolean, table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_staff_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, text, boolean, table_allocation_overrides, uuid, uuid, boolean) TO service_role;

DROP FUNCTION IF EXISTS public.set_christmas_seat_course_v01(uuid, integer, integer, boolean);

-- Tables
DELETE FROM public.booking_preorder_reminders
 WHERE cover_id IS NOT NULL OR kind NOT IN ('booker_reminder', 'manager_escalation');
DROP INDEX IF EXISTS public.booking_preorder_reminders_booking_kind_cover_key;
DROP INDEX IF EXISTS public.booking_preorder_reminders_booking_kind_key;
ALTER TABLE public.booking_preorder_reminders DROP CONSTRAINT IF EXISTS booking_preorder_reminders_cover_kind_check;
ALTER TABLE public.booking_preorder_reminders DROP CONSTRAINT IF EXISTS booking_preorder_reminders_kind_check;
ALTER TABLE public.booking_preorder_reminders DROP COLUMN IF EXISTS cover_id;
ALTER TABLE public.booking_preorder_reminders ADD CONSTRAINT booking_preorder_reminders_kind_check
  CHECK (kind = ANY (ARRAY['booker_reminder'::text, 'manager_escalation'::text]));
ALTER TABLE public.booking_preorder_reminders ADD CONSTRAINT booking_preorder_reminders_table_booking_id_kind_key
  UNIQUE (table_booking_id, kind);

DELETE FROM public.guest_tokens WHERE action_type = 'preorder_guest';
DROP INDEX IF EXISTS public.idx_guest_tokens_preorder_cover;
ALTER TABLE public.guest_tokens DROP CONSTRAINT IF EXISTS guest_tokens_preorder_guest_scope_check;
ALTER TABLE public.guest_tokens DROP CONSTRAINT IF EXISTS guest_tokens_action_type_check;
ALTER TABLE public.guest_tokens DROP COLUMN IF EXISTS preorder_cover_id;
ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_action_type_check
  CHECK (action_type = ANY (ARRAY['manage'::text, 'sunday_preorder'::text, 'card_capture'::text, 'payment'::text,
    'review_redirect'::text, 'charge_approval'::text, 'waitlist_offer'::text, 'private_feedback'::text,
    'private_booking_outcome'::text, 'booking_confirm'::text, 'email_capture'::text]));

ALTER TABLE public.booking_period_menu_items DROP COLUMN IF EXISTS is_child_option;

DROP TRIGGER booking_preorder_covers_touch_updated_at ON public.booking_preorder_covers;
CREATE TRIGGER booking_preorder_covers_touch_updated_at
BEFORE UPDATE OF guest_name, dietary_note ON public.booking_preorder_covers
FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();

ALTER TABLE public.booking_preorder_covers
  DROP CONSTRAINT IF EXISTS booking_preorder_covers_allergy_detail_check,
  DROP CONSTRAINT IF EXISTS booking_preorder_covers_invite_email_check,
  DROP CONSTRAINT IF EXISTS booking_preorder_covers_last_saved_by_check,
  DROP COLUMN IF EXISTS has_allergies,
  DROP COLUMN IF EXISTS allergy_detail,
  DROP COLUMN IF EXISTS invite_email,
  DROP COLUMN IF EXISTS invite_sent_at,
  DROP COLUMN IF EXISTS invite_reminded_at,
  DROP COLUMN IF EXISTS last_saved_by,
  DROP COLUMN IF EXISTS last_saved_at;

-- Data, back to the values production held on 6 November 2026.
UPDATE public.booking_periods
   SET min_notice_hours = 24,
       max_party_size = 20,
       guest_blurb = 'Our festive set menu, 10 November to 20 December. Choose your courses when you book.'
 WHERE code = 'christmas-2026';

DELETE FROM public.system_settings WHERE key = 'christmas_staff_max_party';

-- Neither flag existed before the migration, so both keys are removed rather than set false.
UPDATE public.system_settings
   SET value = value - 'table_deposit_hold_reminder' - 'table_preorder_choices_copy'
 WHERE key = 'messaging_flags';

DELETE FROM public.menu_dish_menu_assignments a
 USING public.menu_dishes d
 WHERE a.dish_id = d.id AND d.slug = 'christmas-dinner-vegetable-wellington';
DELETE FROM public.menu_dishes WHERE slug = 'christmas-dinner-vegetable-wellington';
