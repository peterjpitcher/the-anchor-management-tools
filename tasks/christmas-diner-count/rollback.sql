-- Rollback for supabase/migrations/20261126120000_christmas_diner_count.sql.
--
-- Restores the four functions exactly as production held them on 26 November 2026 (bodies copied
-- from the migrations production ran, prosrc md5 checked by scripts/testing/christmas-diner-count-postgres.py),
-- drops the two new functions, then the column and its CHECK.
--
-- Run it only once no booking has christmas_diner_count set, or with a plan for those bookings: the
-- old functions would treat every seat as a Christmas dinner again (the course list and the pre-order
-- seats would grow back to the party size on the next write) and the deposit already recorded on
-- the booking would no longer match what the rule says for its seats.
BEGIN;

-- From 20260809100000_group_deposit_threshold_15.sql.
CREATE OR REPLACE FUNCTION public.resolve_table_booking_deposit(
  p_party_size integer,
  p_booking_date date,
  p_period_id uuid DEFAULT NULL::uuid,
  p_period_answer boolean DEFAULT NULL::boolean,
  p_deposit_waived boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_group_threshold  constant integer := 15;
  c_group_per_head   constant numeric := 10.0;

  v_period           public.booking_periods;
  v_group_amount     numeric(10,2) := 0;
  v_period_amount    numeric(10,2) := 0;
  v_accepted         boolean := COALESCE(p_period_answer, false);
  v_collect          boolean;
  v_refund_policy    text;
BEGIN
  -- THE KILL SWITCH, read here rather than passed in. Read inside the one function that decides
  -- money and no caller can forget it, which is exactly what happened to the first version of this
  -- feature: the switch was consulted by a read endpoint and by nothing that charged anybody.
  -- It suppresses the SEASONAL rule only. A party of twenty still pays the large-group deposit
  -- they have always paid, so switching seasonal collection off at 7pm on a Friday cannot
  -- accidentally make the pub stop taking deposits altogether.
  v_collect := public.get_setting_bool('booking_period_deposits_enabled', true);
  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_party_size');
  END IF;

  -- 1. Waiver wins outright.
  IF COALESCE(p_deposit_waived, false) THEN
    RETURN jsonb_build_object(
      'ok', true, 'required', false, 'amount', 0, 'rule', 'waived',
      'basis', NULL, 'rate', NULL,
      'reason', 'A manager waived the deposit for this booking.',
      'period_id', NULL, 'period_code', NULL, 'period_name', NULL,
      'refund_cutoff_days', NULL, 'refund_policy', NULL
    );
  END IF;

  -- 2. Re-read the period server side. The client's copy is never used for money.
  IF p_period_id IS NOT NULL THEN
    SELECT * INTO v_period FROM public.booking_periods WHERE id = p_period_id;

    IF v_period.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_not_found');
    END IF;
    IF v_period.archived_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_archived');
    END IF;
    IF NOT v_period.is_active THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_inactive');
    END IF;
    IF p_booking_date IS NULL OR p_booking_date NOT BETWEEN v_period.starts_on AND v_period.ends_on THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_date_mismatch');
    END IF;

    IF v_accepted THEN
      IF v_period.min_party_size IS NOT NULL AND p_party_size < v_period.min_party_size THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'period_party_too_small');
      END IF;
      IF v_period.max_party_size IS NOT NULL AND p_party_size > v_period.max_party_size THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'period_party_too_large');
      END IF;
      IF NOT public.booking_period_menu_ready(v_period.id) THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'period_menu_not_ready');
      END IF;

      -- The guest's answer is still recorded when collection is off. Only the money stops.
      IF v_collect THEN
        v_period_amount := ROUND(
          CASE v_period.deposit_basis
            WHEN 'per_head'    THEN p_party_size::numeric * v_period.deposit_amount
            WHEN 'per_booking' THEN v_period.deposit_amount
            ELSE 0
          END, 2);
      END IF;
    END IF;

    -- Worked out once, because it belongs to whichever deposit ends up being charged on a booking
    -- where the guest accepted this offer, not only to the seasonal branch below.
    --
    -- WORD FOR WORD what describeRefundPolicy() produces in
    -- src/lib/table-bookings/period-deposit.ts, last sentence included. The website shows the guest
    -- that version on the way in; this is the version STORED on the booking, which the freeze
    -- trigger then makes permanent. A difference between the two means the sentence that settles a
    -- dispute is not the sentence the guest was given, which is precisely the evidence gap the
    -- snapshot exists to close. A test compares the two strings and fails if they drift.
    IF v_accepted THEN
      v_refund_policy := CASE
        WHEN v_period.refund_cutoff_days <= 0
          THEN 'The deposit is not refundable once the booking is made, though a manager may waive that.'
        ELSE format(
          'Full refund up to %s days before the booking date. Inside %s days the deposit is not refunded, though a manager may waive that. The deposit comes off the bill on the day.',
          v_period.refund_cutoff_days, v_period.refund_cutoff_days)
      END;
    END IF;
  END IF;

  -- 3. The party-size rule, always evaluated.
  IF p_party_size >= c_group_threshold THEN
    v_group_amount := ROUND(p_party_size::numeric * c_group_per_head, 2);
  END IF;

  -- 4. Larger wins, never stacks. A tie goes to the period so the guest-facing wording names the
  --    season rather than "large group".
  IF v_period_amount > 0 AND v_period_amount >= v_group_amount THEN
    RETURN jsonb_build_object(
      'ok', true, 'required', true, 'amount', v_period_amount, 'rule', 'period',
      'basis', v_period.deposit_basis, 'rate', v_period.deposit_amount,
      'reason', format('%s deposit, %s.', v_period.name,
        CASE v_period.deposit_basis
          WHEN 'per_head' THEN format('GBP %s per guest', trim(to_char(v_period.deposit_amount, 'FM999990.00')))
          ELSE format('GBP %s for the booking', trim(to_char(v_period.deposit_amount, 'FM999990.00')))
        END),
      'period_id', v_period.id, 'period_code', v_period.code, 'period_name', v_period.name,
      'refund_cutoff_days', v_period.refund_cutoff_days,
      'refund_policy', v_refund_policy
    );
  END IF;

  IF v_group_amount > 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'required', true, 'amount', v_group_amount, 'rule', 'group',
      'basis', 'per_head', 'rate', c_group_per_head,
      'reason', format('Parties of %s or more pay GBP %s per guest.', c_group_threshold,
                       trim(to_char(c_group_per_head, 'FM999990.00'))),
      'period_id', CASE WHEN v_accepted THEN v_period.id ELSE NULL END,
      'period_code', CASE WHEN v_accepted THEN v_period.code ELSE NULL END,
      'period_name', CASE WHEN v_accepted THEN v_period.name ELSE NULL END,
      -- A deposit taken on a booking where the guest accepted the seasonal offer is governed by
      -- that period's refund promise, even though the party-size rule produced the larger number.
      -- Dropping the terms here left the guest holding a promise the booking row could not evidence.
      'refund_cutoff_days', CASE WHEN v_accepted THEN v_period.refund_cutoff_days ELSE NULL END,
      'refund_policy', v_refund_policy
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'required', false, 'amount', 0, 'rule', 'none',
    'basis', NULL, 'rate', NULL,
    'reason', CASE
      WHEN v_accepted AND NOT v_collect
        THEN 'No deposit is being taken: seasonal deposit collection is switched off in Settings.'
      ELSE 'No deposit is due for this booking.'
    END,
    'period_id', CASE WHEN v_accepted THEN v_period.id ELSE NULL END,
    'period_code', CASE WHEN v_accepted THEN v_period.code ELSE NULL END,
    'period_name', CASE WHEN v_accepted THEN v_period.name ELSE NULL END,
    -- No deposit means no refund promise to carry.
    'refund_cutoff_days', NULL, 'refund_policy', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_table_booking_deposit(integer, date, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_table_booking_deposit(integer, date, uuid, boolean, boolean) TO service_role;

-- From 20261106210000_christmas_food_link.sql.
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

-- From 20261027132744_christmas_seats_for_every_guest.sql.
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
  -- A Christmas booking with courses recorded wants one too, whatever the tiers, so every guest,
  -- 1 course included, has a seat for a name and a dietary note (BK-148).
  IF (COALESCE(v_booking.booking_period_requires_preorder, false)
      OR v_booking.christmas_course_counts IS NOT NULL)
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

-- From 20261106210000_christmas_food_link.sql.
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

DROP FUNCTION public.convert_table_booking_to_christmas_v01(uuid, integer, text);
DROP FUNCTION public.resolve_table_booking_deposit_v02(integer, date, uuid, boolean, boolean, integer);
ALTER TABLE public.table_bookings DROP CONSTRAINT table_bookings_christmas_diner_count_check;
ALTER TABLE public.table_bookings DROP COLUMN christmas_diner_count;
COMMIT;
