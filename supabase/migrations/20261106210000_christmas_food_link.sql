-- Christmas dinner: book the table, then choose the food by link (spec tasks/christmas-food-link/
-- spec.md, owner decisions D1 to D16 of 6 November 2026, section 3.1).
--
-- A Christmas booking now takes the table and the deposit only. Every guest's courses and dishes are
-- chosen afterwards on the food page, by the organiser or by the guest through their own link, so a
-- seat's tier starts at 0 ("not chosen yet") and is set one seat at a time.
--
-- Additive and backwards compatible: the website's current payload (course counts of 1 to 3 at
-- booking) is still accepted, and nothing here removes a column, a kind or an action type.
--
-- Schema:
--   * booking_preorder_covers gains has_allergies (null = not answered), allergy_detail (300),
--     invite_email (254), invite_sent_at, invite_reminded_at, last_saved_by (organiser, guest or
--     staff) and last_saved_at. The seat touch trigger also fires on has_allergies and
--     allergy_detail, so an allergy changed after the cutoff shows as a late change on the kitchen
--     sheet like a changed dietary note does.
--   * booking_period_menu_items gains is_child_option (kids mains are 1 course only, A1).
--   * guest_tokens gains preorder_cover_id and accepts action_type 'preorder_guest': one guest's link
--     to their own seat. A preorder_guest token must name its booking and its seat, and only a
--     preorder_guest token may name a seat.
--   * booking_preorder_reminders gains cover_id and the ladder's kinds. Uniqueness is one row per
--     booking and kind when cover_id is null (exactly as before), and one per booking, kind and seat
--     otherwise. The old kinds stay valid for history. Guest kinds always name a seat and nothing
--     else does.
--
-- Functions (bodies checked against production on 6 November 2026, md5(prosrc)):
--   * assert_christmas_course_snapshot_v01 (was ae3fa916c36cc8aafb8bbdd6c55bff6c): seats are 0 to 3,
--     0 meaning not chosen; an accepted Christmas booking inserted with no list gets a 0 per guest; a
--     list shorter than the party is padded with 0, a longer one is still refused; every Christmas
--     booking with a list requires a pre-order; the deadline guard is skipped while
--     anchor.christmas_staff_override is 'on' (set only by set_christmas_seat_course_v01 for a staff
--     save); on a tier change, starters and desserts beyond what the seat's tier allows are cleared
--     (all of them on 0 or 1) but the main is kept, and a kids main on a seat moving to 2 or 3
--     courses is cleared.
--   * assert_christmas_preorder_selection_v01 (was eff49973a4e4bad892dc3c706886bf24): a main is
--     allowed on any tier, a starter or dessert is refused on 0 or 1, a kids main is refused on 2 or
--     3. Add-ons are allowed on any tier. Bookings with no course list are untouched.
--   * set_christmas_seat_course_v01 (new): sets one seat's tier atomically, so an organiser and a
--     guest saving different seats never overwrite each other. SECURITY DEFINER, service_role only.
--   * change_christmas_party_v01 (was 92c12a21c38386e8d76805d81352faea): a guest who joins gets
--     tier 0, whatever the caller sent, and their courses are chosen on the food page. Its own
--     after-the-deadline check is skipped under the staff override, like the trigger's.
--   * create_table_booking_staff_v06 (was da7e2723b287c7b738ea1d468a3d372d): when the guest accepted
--     the Christmas period, the party limit is the larger of table_booking_max_party_online and the
--     new setting christmas_staff_max_party (default 60, A3). The public entry point keeps 20. A
--     staff Christmas party above 20 is passed to create_table_booking_core_v06 as an accepted
--     Christmas period with purpose food, because core's legacy 'christmas' purpose keeps the
--     website's 20 guest private-hire refusal; core stores the two the same way (booking_type from
--     the period's legacy_booking_type, booking_purpose 'food').
--   Every function keeps SECURITY INVOKER or DEFINER and search_path exactly as production has it,
--   and EXECUTE for service_role only.
--
-- Data (production as of 6 November 2026):
--   * period christmas-2026: min_notice_hours 24 -> 192 (D2), max_party_size 20 -> 60 (A3), and the
--     new guest_blurb;
--   * system_settings christmas_staff_max_party = 60 (left alone if it already exists);
--   * messaging_flags: table_deposit_hold_reminder and table_preorder_choices_copy set true, merged
--     into the existing object so no other flag changes;
--   * the three Kids Christmas Dinner mains of christmas-2026 are marked is_child_option, matched by
--     course and name (the block refuses to run unless it finds exactly three);
--   * a 1 course menu dish "Christmas Dinner, Vegetable Wellington" at 24 (D16) on the christmas
--     menu, beside the other adult 1 course mains. Allergens are left empty for the kitchen to enter:
--     an empty list is shown as "See menu or contact us for allergen information". The period's own
--     menu already lists the Wellington as a main, so nothing is added there.
--
-- Rollback: tasks/christmas-food-link/rollback.sql. Tested by
-- scripts/testing/christmas-food-link-postgres.py.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.booking_preorder_covers
  ADD COLUMN has_allergies boolean,
  ADD COLUMN allergy_detail text,
  ADD COLUMN invite_email text,
  ADD COLUMN invite_sent_at timestamptz,
  ADD COLUMN invite_reminded_at timestamptz,
  ADD COLUMN last_saved_by text,
  ADD COLUMN last_saved_at timestamptz,
  ADD CONSTRAINT booking_preorder_covers_allergy_detail_check
    CHECK (allergy_detail IS NULL OR length(allergy_detail) <= 300),
  ADD CONSTRAINT booking_preorder_covers_invite_email_check
    CHECK (invite_email IS NULL OR length(invite_email) <= 254),
  ADD CONSTRAINT booking_preorder_covers_last_saved_by_check
    CHECK (last_saved_by IS NULL OR last_saved_by IN ('organiser', 'guest', 'staff'));

COMMENT ON COLUMN public.booking_preorder_covers.has_allergies IS
  'Null until the guest answers. True needs allergy_detail (checked in the application).';
COMMENT ON COLUMN public.booking_preorder_covers.invite_email IS
  'The guest''s own address, used only for their food link and one reminder, and cleared after the booking (A4).';
COMMENT ON COLUMN public.booking_preorder_covers.last_saved_by IS
  'Who last saved this seat: organiser, guest or staff.';

DROP TRIGGER booking_preorder_covers_touch_updated_at ON public.booking_preorder_covers;
CREATE TRIGGER booking_preorder_covers_touch_updated_at
BEFORE UPDATE OF guest_name, dietary_note, has_allergies, allergy_detail ON public.booking_preorder_covers
FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();

ALTER TABLE public.booking_period_menu_items
  ADD COLUMN is_child_option boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.booking_period_menu_items.is_child_option IS
  'A kids main. Offered on 1 course only; refused on 2 or 3 courses by assert_christmas_preorder_selection_v01.';

ALTER TABLE public.guest_tokens
  ADD COLUMN preorder_cover_id uuid REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE;

ALTER TABLE public.guest_tokens DROP CONSTRAINT guest_tokens_action_type_check;
ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_action_type_check
  CHECK (action_type = ANY (ARRAY['manage'::text, 'sunday_preorder'::text, 'card_capture'::text, 'payment'::text,
    'review_redirect'::text, 'charge_approval'::text, 'waitlist_offer'::text, 'private_feedback'::text,
    'private_booking_outcome'::text, 'booking_confirm'::text, 'email_capture'::text, 'preorder_guest'::text]));
ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_preorder_guest_scope_check
  CHECK (CASE WHEN action_type = 'preorder_guest'
              THEN table_booking_id IS NOT NULL AND preorder_cover_id IS NOT NULL
              ELSE preorder_cover_id IS NULL END);

CREATE INDEX idx_guest_tokens_preorder_cover ON public.guest_tokens (preorder_cover_id)
  WHERE preorder_cover_id IS NOT NULL;

ALTER TABLE public.booking_preorder_reminders
  ADD COLUMN cover_id uuid REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE;

ALTER TABLE public.booking_preorder_reminders DROP CONSTRAINT booking_preorder_reminders_kind_check;
ALTER TABLE public.booking_preorder_reminders ADD CONSTRAINT booking_preorder_reminders_kind_check
  CHECK (kind = ANY (ARRAY['booker_reminder'::text, 'manager_escalation'::text,
    'booker_21d'::text, 'booker_14d'::text, 'booker_10d'::text, 'booker_day_before'::text,
    'booker_cutoff_morning'::text, 'manager_day_before'::text, 'guest_invite'::text, 'guest_reminder'::text]));
ALTER TABLE public.booking_preorder_reminders ADD CONSTRAINT booking_preorder_reminders_cover_kind_check
  CHECK ((kind IN ('guest_invite', 'guest_reminder')) = (cover_id IS NOT NULL));

-- The ledger is the cron's idempotency: a claim is an insert, and a duplicate key means somebody
-- already sent it. A booking-level kind keeps exactly the old rule; a guest kind is once per seat.
ALTER TABLE public.booking_preorder_reminders DROP CONSTRAINT booking_preorder_reminders_table_booking_id_kind_key;
CREATE UNIQUE INDEX booking_preorder_reminders_booking_kind_key
  ON public.booking_preorder_reminders (table_booking_id, kind) WHERE cover_id IS NULL;
CREATE UNIQUE INDEX booking_preorder_reminders_booking_kind_cover_key
  ON public.booking_preorder_reminders (table_booking_id, kind, cover_id) WHERE cover_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The course list on a Christmas booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_christmas_course_snapshot_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE
  v_counts integer[];
  v_multi boolean;
  -- Set to 'on' for one statement by set_christmas_seat_course_v01 when staff save after the cutoff
  -- (D8: the organiser and guests cannot change choices after it; staff can).
  v_staff_override boolean := coalesce(current_setting('anchor.christmas_staff_override', true), '') = 'on';
BEGIN
  -- Every guest of an accepted Christmas booking chooses later, on the food page (D1, D4), so a
  -- booking taken with no list starts with every seat on 0, "not chosen yet".
  IF TG_OP = 'INSERT' AND NEW.christmas_course_counts IS NULL
     AND NEW.booking_type::text = 'christmas' AND NEW.booking_period_answer IS TRUE
     AND coalesce(NEW.party_size, 0) >= 1 THEN
    NEW.christmas_course_counts := array_fill(0, ARRAY[NEW.party_size]);
  END IF;
  IF NEW.christmas_course_counts IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL THEN
      RAISE EXCEPTION 'Christmas course choices cannot be cleared.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  v_counts := NEW.christmas_course_counts;
  IF (cardinality(v_counts) > 0 AND (array_ndims(v_counts) <> 1 OR array_lower(v_counts, 1) <> 1))
     OR cardinality(v_counts) > coalesce(NEW.party_size, 0)
     OR EXISTS (SELECT 1 FROM unnest(v_counts) c WHERE c IS NULL OR c NOT BETWEEN 0 AND 3) THEN
    RAISE EXCEPTION 'Christmas bookings need a course choice for every guest when changing the party size.' USING ERRCODE = '22023';
  END IF;
  -- Guests who join choose later too: their seats are padded with 0.
  IF cardinality(v_counts) < NEW.party_size THEN
    NEW.christmas_course_counts := v_counts || array_fill(0, ARRAY[NEW.party_size - cardinality(v_counts)]);
  END IF;
  IF NEW.booking_type::text <> 'christmas' OR NEW.booking_period_answer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Christmas course choices must remain attached to a Christmas booking.' USING ERRCODE = '22023';
  END IF;
  -- Every guest now chooses, 1 course included, so every Christmas booking with a list needs one.
  NEW.booking_period_requires_preorder := true;
  v_multi := EXISTS (SELECT 1 FROM unnest(NEW.christmas_course_counts) c WHERE c > 1);
  IF TG_OP = 'UPDATE' AND v_multi AND NOT v_staff_override AND (
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
    -- A seat keeps its dishes while they fit its tier. Every tier has a main, so the main stays; a
    -- seat on 0 or 1 has no starter or dessert, and one on 2 has at most one of them, so a seat
    -- over that loses both and its guest picks again. Judged on the seat as it now stands, because
    -- change_christmas_party_v01 has already closed up the seat numbers when a guest left. This runs
    -- in the same transaction as the amendment, so a later failure restores both.
    DELETE FROM public.booking_preorder_selections s USING public.booking_preorder_covers c
      WHERE s.cover_id = c.id AND c.table_booking_id = NEW.id
        AND c.ordinal <= cardinality(NEW.christmas_course_counts)
        AND s.course IN ('starter', 'dessert')
        AND (NEW.christmas_course_counts[c.ordinal] <= 1
          OR (SELECT count(*) FROM public.booking_preorder_selections x
               WHERE x.cover_id = c.id AND x.course IN ('starter', 'dessert'))
             > NEW.christmas_course_counts[c.ordinal] - 1);
    -- Kids mains are 1 course only (A1).
    DELETE FROM public.booking_preorder_selections s
      USING public.booking_preorder_covers c, public.booking_period_menu_items m
      WHERE s.cover_id = c.id AND c.table_booking_id = NEW.id
        AND c.ordinal <= cardinality(NEW.christmas_course_counts)
        AND s.course = 'main' AND m.id = s.menu_item_id AND m.is_child_option
        AND NEW.christmas_course_counts[c.ordinal] >= 2;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_christmas_course_snapshot_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_course_snapshot_v01() TO service_role;

CREATE OR REPLACE FUNCTION public.assert_christmas_preorder_selection_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE
  v_has_list boolean;
  v_tier integer;
BEGIN
  SELECT b.christmas_course_counts IS NOT NULL, b.christmas_course_counts[c.ordinal]
    INTO v_has_list, v_tier
    FROM public.booking_preorder_covers c
    JOIN public.table_bookings b ON b.id = c.table_booking_id
   WHERE c.id = NEW.cover_id;
  -- A booking with no course list keeps its old rule, which the application checks.
  IF NOT coalesce(v_has_list, false) THEN
    RETURN NEW;
  END IF;
  -- A seat above the list is waiting for preorder_sync_covers, so it counts as not chosen.
  IF NEW.course IN ('starter', 'dessert') AND coalesce(v_tier, 0) <= 1 THEN
    RAISE EXCEPTION 'A starter or a dessert needs 2 or 3 courses. Choose the number of courses first.' USING ERRCODE = '22023';
  END IF;
  IF NEW.course = 'main' AND coalesce(v_tier, 0) >= 2 AND EXISTS (
       SELECT 1 FROM public.booking_period_menu_items m WHERE m.id = NEW.menu_item_id AND m.is_child_option) THEN
    RAISE EXCEPTION 'Kids Christmas dinners are 1 course only.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_christmas_preorder_selection_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_preorder_selection_v01() TO service_role;

-- One seat's tier, and nothing else on the booking. p_ordinal is the seat number (1-based) and
-- p_course_count 0 to 3. p_staff_override lets a staff save through the deadline guard (D8); the
-- override is switched on for this update only and put back as it was straight after.
CREATE FUNCTION public.set_christmas_seat_course_v01(
  p_table_booking_id uuid,
  p_ordinal integer,
  p_course_count integer,
  p_staff_override boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_counts integer[];
  v_previous integer;
  v_setting text;
  v_row public.table_bookings;
BEGIN
  IF p_course_count IS NULL OR p_course_count NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'Choose 1, 2 or 3 courses.' USING ERRCODE = '22023';
  END IF;
  SELECT b.christmas_course_counts INTO v_counts
    FROM public.table_bookings b WHERE b.id = p_table_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_counts IS NULL THEN
    RAISE EXCEPTION 'This booking has no Christmas course list.' USING ERRCODE = '22023';
  END IF;
  IF p_ordinal IS NULL OR p_ordinal < 1 OR p_ordinal > cardinality(v_counts) THEN
    RAISE EXCEPTION 'That seat is not on this booking.' USING ERRCODE = '22023';
  END IF;
  v_previous := v_counts[p_ordinal];

  IF v_previous IS DISTINCT FROM p_course_count THEN
    v_setting := current_setting('anchor.christmas_staff_override', true);
    IF coalesce(p_staff_override, false) THEN
      PERFORM set_config('anchor.christmas_staff_override', 'on', true);
    END IF;
    -- The trigger checks the deadline and clears dishes the seat's new tier does not have.
    UPDATE public.table_bookings
       SET christmas_course_counts[p_ordinal] = p_course_count,
           updated_at = now()
     WHERE id = p_table_booking_id
     RETURNING * INTO v_row;
    IF coalesce(p_staff_override, false) THEN
      PERFORM set_config('anchor.christmas_staff_override', coalesce(v_setting, ''), true);
    END IF;
    v_counts := v_row.christmas_course_counts;
  END IF;

  RETURN jsonb_build_object(
    'table_booking_id', p_table_booking_id,
    'ordinal', p_ordinal,
    'course_count', p_course_count,
    'previous_course_count', v_previous,
    'changed', v_previous IS DISTINCT FROM p_course_count,
    'christmas_course_counts', to_jsonb(v_counts)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_christmas_seat_course_v01(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_christmas_seat_course_v01(uuid, integer, integer, boolean) TO service_role;

-- p_course_counts is the whole new party in seat order: the guests who stay first, in their old
-- order, then anyone added. A guest who joins gets tier 0 whatever is sent here, and their courses
-- are chosen on the food page. p_removed_ordinals names the leaving guests by their current seat
-- number. p_expected_course_counts is the course list the person saw when they chose who was leaving
-- (an empty list when none was recorded): seat numbers only name the same guests while it still holds.
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
  v_kept integer;
  v_counts integer[];
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

  -- The guests who stay keep the tier sent for them; anyone after them is joining and starts on 0.
  -- A booking recording its first list has nobody joining: every seat is as sent.
  v_kept := CASE WHEN v_old IS NULL THEN cardinality(p_course_counts)
                 ELSE cardinality(v_old) - cardinality(v_removed) END;
  v_counts := ARRAY(
    SELECT CASE WHEN n.seat > v_kept THEN 0 ELSE n.tier END
      FROM unnest(p_course_counts) WITH ORDINALITY AS n(tier, seat)
     ORDER BY n.seat);

  -- After the deadline, guest by guest, which the trigger cannot do: nobody who stays moves up. The
  -- trigger still checks the party as a whole. Staff saving under the override may.
  IF v_old IS NOT NULL
     AND coalesce(current_setting('anchor.christmas_staff_override', true), '') <> 'on'
     AND (public.christmas_course_policy_v01(v_date)->>'multiple_courses_available')::boolean IS DISTINCT FROM true
     AND EXISTS (
         SELECT 1
           FROM (SELECT u.tier, row_number() OVER (ORDER BY u.seat) AS kept_seat
                   FROM unnest(v_old) WITH ORDINALITY AS u(tier, seat)
                  WHERE NOT (u.seat = ANY (v_removed))) kept
          WHERE v_counts[kept.kept_seat] > kept.tier) THEN
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
    -- unique and not deferrable; a staff Christmas party is at most christmas_staff_max_party (60),
    -- so 1000 is clear of every real seat.
    UPDATE public.booking_preorder_covers SET ordinal = ordinal + 1000
     WHERE table_booking_id = p_booking_id AND ordinal > (SELECT min(r) FROM unnest(v_removed) r);
    UPDATE public.booking_preorder_covers c
       SET ordinal = (c.ordinal - 1000) - (SELECT count(*) FROM unnest(v_removed) r WHERE r < c.ordinal - 1000)
     WHERE c.table_booking_id = p_booking_id AND c.ordinal > 1000;
  END IF;

  -- The trigger above checks the new list and the deadline, and clears dishes a seat no longer has.
  UPDATE public.table_bookings
     SET party_size = cardinality(v_counts),
         committed_party_size = cardinality(v_counts),
         christmas_course_counts = v_counts,
         updated_at = now()
   WHERE id = p_booking_id
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'party_size', v_row.party_size,
    'committed_party_size', v_row.committed_party_size,
    'christmas_course_counts', to_jsonb(v_row.christmas_course_counts),
    'updated_at', v_row.updated_at,
    'removed', v_dropped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[], integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[], integer[]) TO service_role;

CREATE OR REPLACE FUNCTION public.create_table_booking_staff_v06(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text DEFAULT 'food'::text, p_notes text DEFAULT NULL::text, p_sunday_lunch boolean DEFAULT false, p_source text DEFAULT 'admin'::text, p_bypass_cutoff boolean DEFAULT false, p_deposit_waived boolean DEFAULT false, p_bypass_pacing boolean DEFAULT false, p_high_chair_count integer DEFAULT 0, p_outside_seating boolean DEFAULT false, p_requires_accessible_table boolean DEFAULT false, p_channel text DEFAULT 'staff'::text, p_pin boolean DEFAULT false, p_overrides table_allocation_overrides DEFAULT NULL::table_allocation_overrides, p_actor_id uuid DEFAULT NULL::uuid, p_booking_period_id uuid DEFAULT NULL::uuid, p_booking_period_answer boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period public.booking_periods;
  v_purpose text := p_booking_purpose;
  v_answer boolean := p_booking_period_answer;
  -- One party limit for every channel (owner decision D30, BK-146).
  v_max_party integer := public.get_setting_int('table_booking_max_party_online', 20);
BEGIN
  -- A Christmas booking taken by staff may be bigger (A3): the seated Christmas capacity, held as
  -- christmas_staff_max_party. "Accepted" is the same test core applies: the live period for the
  -- date is a Christmas one, and the guest said yes or the booking is for the Christmas purpose.
  SELECT * INTO v_period FROM public.get_booking_period_for_date(p_booking_date);
  IF v_period.id IS NOT NULL AND v_period.period_kind = 'christmas'
     AND (p_booking_period_id IS NULL OR p_booking_period_id = v_period.id)
     AND (coalesce(p_booking_period_answer, false) OR lower(trim(coalesce(p_booking_purpose, ''))) = 'christmas') THEN
    v_max_party := greatest(v_max_party, public.get_setting_int('christmas_staff_max_party', 60));
    -- Core's legacy 'christmas' purpose refuses more than 20 as private hire, which is the website's
    -- rule. Above 20 the same booking goes in as an accepted Christmas period with purpose food, which
    -- core stores identically (booking_type from the period, booking_purpose 'food').
    IF p_party_size > 20 AND lower(trim(coalesce(p_booking_purpose, ''))) = 'christmas'
       AND v_period.legacy_booking_type::text = 'christmas' THEN
      v_purpose := 'food';
      v_answer := true;
    END IF;
  END IF;

  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, v_purpose,
    p_notes, p_sunday_lunch, p_source, p_bypass_cutoff, p_deposit_waived, p_bypass_pacing,
    p_high_chair_count, p_outside_seating, p_requires_accessible_table,
    COALESCE(NULLIF(p_channel, 'online'), 'staff'),   -- staff entry cannot masquerade as online
    p_pin,
    v_max_party,
    p_overrides, p_actor_id,
    p_booking_period_id, v_answer
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_table_booking_staff_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, text, boolean, table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_staff_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, text, boolean, table_allocation_overrides, uuid, uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

UPDATE public.booking_periods
   SET min_notice_hours = 192,
       max_party_size = 60,
       guest_blurb = 'Our festive set menu, 10 November to 20 December. Book your table now and we''ll email you a link to choose everyone''s food.'
 WHERE code = 'christmas-2026';

INSERT INTO public.system_settings (key, value, description)
VALUES ('christmas_staff_max_party', '{"value": 60}'::jsonb,
        'The largest Christmas party staff can book in the management app. The website stays at 20.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings (key, value)
VALUES ('messaging_flags', '{"table_deposit_hold_reminder": true, "table_preorder_choices_copy": true}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = public.system_settings.value || EXCLUDED.value;

DO $$
DECLARE v_marked integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_periods WHERE code = 'christmas-2026') THEN
    UPDATE public.booking_period_menu_items i
       SET is_child_option = true
      FROM public.booking_periods p
     WHERE p.id = i.period_id AND p.code = 'christmas-2026'
       AND i.course = 'main' AND i.name LIKE 'Kids Christmas Dinner,%';
    GET DIAGNOSTICS v_marked = ROW_COUNT;
    IF v_marked <> 3 THEN
      RAISE EXCEPTION 'Expected the three Kids Christmas Dinner mains on christmas-2026, found %.', v_marked;
    END IF;
  END IF;
END $$;

INSERT INTO public.menu_dishes (name, slug, description, selling_price, is_active, dietary_flags)
VALUES ('Christmas Dinner, Vegetable Wellington', 'christmas-dinner-vegetable-wellington',
        'Vegan Wellington with vegan trimmings and gravy. No Yorkshire pudding or pigs in blankets.',
        24.00, true, ARRAY['vegan'])
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      selling_price = EXCLUDED.selling_price,
      is_active = EXCLUDED.is_active,
      dietary_flags = EXCLUDED.dietary_flags,
      updated_at = now();

INSERT INTO public.menu_dish_menu_assignments (dish_id, menu_id, category_id, sort_order)
SELECT d.id, m.id, c.id, 40
  FROM public.menu_dishes d
  JOIN public.menu_categories c ON c.code = 'christmas_one_course_adult'
  CROSS JOIN public.menu_menus m
 WHERE d.slug = 'christmas-dinner-vegetable-wellington' AND m.code = 'christmas'
ON CONFLICT (dish_id, menu_id, category_id) DO UPDATE
  SET sort_order = EXCLUDED.sort_order,
      updated_at = now();
