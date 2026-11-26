-- A Christmas table booking can seat more people than are having Christmas dinner (owner
-- requirement, 26 November 2026). Example: a family of 12 seats, 9 adults on the Christmas menu and
-- 3 children eating from the normal menu. The GBP 10 a head Christmas deposit is for the 9 people
-- having Christmas dinner (GBP 90), never for every seat. Tables, kitchen covers, high chairs and
-- the party size stay on the full 12 seats.
--
-- WHAT CHANGES
--
--  1. table_bookings.christmas_diner_count: how many guests on a Christmas booking are having
--     Christmas dinner. NULL means every seat is (every booking taken before this release, and every
--     booking taken through the existing create paths), so nothing already booked changes.
--  2. resolve_table_booking_deposit_v02: the one deposit rule, with p_seasonal_diners. The seasonal
--     per-head amount and the period's minimum party use COALESCE(diners, seats); the 15-or-more
--     group rule, the period's maximum and "the larger of the two" stay on seats. The old
--     resolve_table_booking_deposit keeps its signature (an extra defaulted argument would make an
--     ambiguous overload, and a DROP is not backwards compatible) and now delegates with NULL
--     diners, so every existing caller gets exactly the answer it got before.
--  3. assert_christmas_course_snapshot_v01: the course list is one entry per Christmas DINER, filled
--     and padded to COALESCE(christmas_diner_count, party_size). On a booking with a diner count,
--     the party size and the diner count cannot change (scope cut: a change would have to re-price
--     the deposit to the right people, which nothing does yet; a manager rebooks instead).
--  4. preorder_sync_covers: one pre-order seat per Christmas diner. Seats beyond the diners eat
--     from the normal menu and have no Christmas pre-order.
--  5. change_christmas_party_v01: refuses a booking with a diner count, for the same reason as 3.
--  6. convert_table_booking_to_christmas_v01: staff turn a confirmed regular food booking into a
--     Christmas booking in one step, priced by the resolver, left CONFIRMED with the deposit owed
--     (D20, BK-044: never a 24-hour hold the timeout cron cancels), course list and pre-order seats
--     made in the same transaction. The application then sends the guest one deposit request.
--
-- Every replaced function restates SECURITY DEFINER or INVOKER, its search_path and its grants
-- exactly as production holds them (pg_get_functiondef read on 26 November 2026; prosrc md5:
-- resolve_table_booking_deposit 64a531d219249438752e92f6abb50644, assert_christmas_course_snapshot_v01
-- ad494245b967bd66553f3a8b31557e0e, preorder_sync_covers c9fd0890b2ec525b8ddbd1abff898f1c,
-- change_christmas_party_v01 e1ac6b8d4b70bc409d3b5cc59749b6f3). The two new functions are
-- service-role only. Rollback: tasks/christmas-diner-count/rollback.sql. Tested by
-- scripts/testing/christmas-diner-count-postgres.py.

ALTER TABLE public.table_bookings ADD COLUMN christmas_diner_count integer;

-- A CHECK passes on NULL, so each half is spelled out: a set count needs a Christmas booking and a
-- party size, and lies between 1 and the seats.
ALTER TABLE public.table_bookings ADD CONSTRAINT table_bookings_christmas_diner_count_check CHECK (
  christmas_diner_count IS NULL
  OR (
    booking_type = 'christmas'::public.table_booking_type
    AND party_size IS NOT NULL
    AND christmas_diner_count >= 1
    AND christmas_diner_count <= party_size
  )
);

COMMENT ON COLUMN public.table_bookings.christmas_diner_count IS
  'How many guests on a Christmas booking are having Christmas dinner. NULL means every seat is. The Christmas deposit, the course list and the pre-order seats follow it; tables, kitchen covers and party_size stay on seats.';

-- ---------------------------------------------------------------------------------------------
-- 2. The deposit rule, with the Christmas diners.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_table_booking_deposit_v02(
  p_party_size integer,
  p_booking_date date,
  p_period_id uuid DEFAULT NULL::uuid,
  p_period_answer boolean DEFAULT NULL::boolean,
  p_deposit_waived boolean DEFAULT false,
  p_seasonal_diners integer DEFAULT NULL::integer
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
  -- The guests the seasonal per-head deposit is for. NULL diners means every seat.
  v_diners           integer;
BEGIN
  -- THE KILL SWITCH, read here rather than passed in. Read inside the one function that decides
  -- money and no caller can forget it. It suppresses the SEASONAL rule only. A party of twenty
  -- still pays the large-group deposit they have always paid.
  v_collect := public.get_setting_bool('booking_period_deposits_enabled', true);
  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_party_size');
  END IF;
  -- More diners than seats, or none at all, is a broken request, never a smaller deposit.
  IF p_seasonal_diners IS NOT NULL AND (p_seasonal_diners < 1 OR p_seasonal_diners > p_party_size) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_diner_count');
  END IF;
  v_diners := COALESCE(p_seasonal_diners, p_party_size);

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
      -- The minimum is for the seasonal offer, so it counts the guests having it (Christmas dinner
      -- needs 4 people having it). The maximum is about the tables, so it counts seats.
      IF v_period.min_party_size IS NOT NULL AND v_diners < v_period.min_party_size THEN
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
            WHEN 'per_head'    THEN v_diners::numeric * v_period.deposit_amount
            WHEN 'per_booking' THEN v_period.deposit_amount
            ELSE 0
          END, 2);
      END IF;
    END IF;

    -- WORD FOR WORD what describeRefundPolicy() produces in
    -- src/lib/table-bookings/period-deposit.ts, last sentence included. A test compares the two.
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

  -- 3. The party-size rule, always evaluated, on seats.
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
        CASE
          WHEN v_period.deposit_basis = 'per_head' AND v_diners < p_party_size
            THEN format('GBP %s per guest on the seasonal menu (%s of %s guests)',
                        trim(to_char(v_period.deposit_amount, 'FM999990.00')), v_diners, p_party_size)
          WHEN v_period.deposit_basis = 'per_head'
            THEN format('GBP %s per guest', trim(to_char(v_period.deposit_amount, 'FM999990.00')))
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

REVOKE ALL ON FUNCTION public.resolve_table_booking_deposit_v02(integer, date, uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_table_booking_deposit_v02(integer, date, uuid, boolean, boolean, integer) TO service_role;

-- The old entry point keeps its signature and its callers (create_table_booking_core_v06, the
-- website quote, the staff party-size transition) and answers exactly as before: no diners given
-- means every seat is a diner.
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
BEGIN
  RETURN public.resolve_table_booking_deposit_v02(
    p_party_size, p_booking_date, p_period_id, p_period_answer, p_deposit_waived, NULL::integer);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_table_booking_deposit(integer, date, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_table_booking_deposit(integer, date, uuid, boolean, boolean) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. The course list is one entry per Christmas diner.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_christmas_course_snapshot_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_counts integer[];
  v_multi boolean;
  -- Set to 'on' for one statement by set_christmas_seat_course_v01 when staff save after the cutoff
  -- (D8: the organiser and guests cannot change choices after it; staff can).
  v_staff_override boolean := coalesce(current_setting('anchor.christmas_staff_override', true), '') = 'on';
  -- The guests having Christmas dinner: every seat unless the booking says fewer (26 November 2026).
  v_diners integer := coalesce(NEW.christmas_diner_count, NEW.party_size);
BEGIN
  -- A booking with fewer Christmas dinners than seats keeps both numbers as they were taken. A
  -- change would have to re-price the deposit to the right people, which nothing does yet, so it is
  -- refused here, under every writer, and a manager rebooks instead.
  IF TG_OP = 'UPDATE' AND OLD.christmas_diner_count IS NOT NULL AND (
       NEW.party_size IS DISTINCT FROM OLD.party_size
       OR NEW.christmas_diner_count IS DISTINCT FROM OLD.christmas_diner_count) THEN
    RAISE EXCEPTION 'This Christmas booking has more seats than Christmas dinners, so its numbers cannot be changed here. A manager needs to rebook it.' USING ERRCODE = '22023';
  END IF;
  -- Every guest of an accepted Christmas booking chooses later, on the food page (D1, D4), so a
  -- booking taken with no list starts with every Christmas dinner on 0, "not chosen yet".
  IF TG_OP = 'INSERT' AND NEW.christmas_course_counts IS NULL
     AND NEW.booking_type::text = 'christmas' AND NEW.booking_period_answer IS TRUE
     AND coalesce(v_diners, 0) >= 1 THEN
    NEW.christmas_course_counts := array_fill(0, ARRAY[v_diners]);
  END IF;
  IF NEW.christmas_course_counts IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL THEN
      RAISE EXCEPTION 'Christmas course choices cannot be cleared.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  v_counts := NEW.christmas_course_counts;
  IF (cardinality(v_counts) > 0 AND (array_ndims(v_counts) <> 1 OR array_lower(v_counts, 1) <> 1))
     OR cardinality(v_counts) > coalesce(v_diners, 0)
     OR EXISTS (SELECT 1 FROM unnest(v_counts) c WHERE c IS NULL OR c NOT BETWEEN 0 AND 3) THEN
    RAISE EXCEPTION 'Christmas bookings need a course choice for every guest when changing the party size.' USING ERRCODE = '22023';
  END IF;
  -- Guests who join choose later too: their seats are padded with 0.
  IF cardinality(v_counts) < v_diners THEN
    NEW.christmas_course_counts := v_counts || array_fill(0, ARRAY[v_diners - cardinality(v_counts)]);
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
$function$;

REVOKE ALL ON FUNCTION public.assert_christmas_course_snapshot_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_course_snapshot_v01() TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. One pre-order seat per Christmas diner.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preorder_sync_covers(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking   public.table_bookings;
  v_wanted    integer;
  v_removed   jsonb := '[]'::jsonb;
  v_added     integer := 0;
  v_count     integer;
  -- The guests with a pre-order: every seat, unless the booking has fewer Christmas dinners than
  -- seats, whose other guests eat from the normal menu (26 November 2026).
  v_seats     integer;
BEGIN
  SELECT * INTO v_booking FROM public.table_bookings WHERE id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'booking_not_found');
  END IF;
  v_seats := COALESCE(v_booking.christmas_diner_count, v_booking.party_size);

  -- Covers are wanted when the booking's own snapshot says the guest accepted a seasonal offer that
  -- requires a pre-order. The snapshot is read, not the period row, because a manager may have
  -- edited or archived the period since, and that must not change a booking already taken.
  -- A Christmas booking with courses recorded wants one too, whatever the tiers, so every guest,
  -- 1 course included, has a seat for a name and a dietary note (BK-148).
  IF (COALESCE(v_booking.booking_period_requires_preorder, false)
      OR v_booking.christmas_course_counts IS NOT NULL)
     AND COALESCE(v_booking.booking_period_answer, false) THEN
    v_wanted := v_seats;
  ELSE
    -- Not a pre-order booking. Keep whatever covers already exist in step (someone may have taken
    -- the order before the answer changed), but never create the first one.
    SELECT count(*) INTO v_count
      FROM public.booking_preorder_covers WHERE table_booking_id = p_booking_id;
    v_wanted := CASE WHEN v_count > 0 THEN v_seats ELSE 0 END;
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
$function$;

REVOKE ALL ON FUNCTION public.preorder_sync_covers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preorder_sync_covers(uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. The Christmas party change refuses a booking with fewer Christmas dinners than seats.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_christmas_party_v01(p_booking_id uuid, p_course_counts integer[], p_removed_ordinals integer[] DEFAULT '{}'::integer[], p_expected_course_counts integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_old integer[];
  v_date date;
  v_removed integer[] := coalesce(p_removed_ordinals, '{}'::integer[]);
  v_dropped jsonb := '[]'::jsonb;
  v_row public.table_bookings;
  v_kept integer;
  v_counts integer[];
  v_diners integer;
BEGIN
  SELECT b.christmas_course_counts, b.booking_date, b.christmas_diner_count INTO v_old, v_date, v_diners
    FROM public.table_bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking was not found.' USING ERRCODE = 'P0002';
  END IF;
  -- This function sets the party size to the length of the course list, which on a booking with
  -- fewer Christmas dinners than seats would shrink the seats to the diners. Refused before anything
  -- moves; the trigger refuses the same change under any other writer (26 November 2026).
  IF v_diners IS NOT NULL THEN
    RAISE EXCEPTION 'This Christmas booking has more seats than Christmas dinners, so its numbers cannot be changed here. A manager needs to rebook it.' USING ERRCODE = '22023';
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
$function$;

REVOKE ALL ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[], integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_christmas_party_v01(uuid, integer[], integer[], integer[]) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Staff turn a confirmed regular food booking into a Christmas booking, in one step.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_table_booking_to_christmas_v01(
  p_booking_id uuid,
  p_christmas_diners integer,
  p_internal_note text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking  public.table_bookings;
  v_period   public.booking_periods;
  v_deposit  jsonb;
  v_amount   numeric(10,2);
  v_note     text := NULLIF(trim(COALESCE(p_internal_note, '')), '');
  v_covers   jsonb;
  v_row      public.table_bookings;
BEGIN
  SELECT * INTO v_booking FROM public.table_bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking was not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Only a live, confirmed, ordinary food booking that has not started. Anything else either has a
  -- deposit story of its own or is already in front of staff.
  IF v_booking.status::text <> 'confirmed' THEN
    RAISE EXCEPTION 'Only a confirmed booking can be changed to Christmas dinner.' USING ERRCODE = '22023';
  END IF;
  IF v_booking.seated_at IS NOT NULL OR v_booking.left_at IS NOT NULL
     OR v_booking.start_datetime IS NULL OR v_booking.start_datetime <= now() THEN
    RAISE EXCEPTION 'This booking has already started, so it cannot be changed to Christmas dinner.' USING ERRCODE = '22023';
  END IF;
  IF v_booking.booking_type::text <> 'regular' OR COALESCE(v_booking.booking_purpose, '') <> 'food' THEN
    RAISE EXCEPTION 'Only an ordinary food booking can be changed to Christmas dinner.' USING ERRCODE = '22023';
  END IF;
  IF v_booking.event_id IS NOT NULL OR v_booking.event_booking_id IS NOT NULL
     OR COALESCE(v_booking.is_venue_event, false) THEN
    RAISE EXCEPTION 'This booking belongs to an event, so it cannot be changed to Christmas dinner.' USING ERRCODE = '22023';
  END IF;
  IF v_booking.christmas_course_counts IS NOT NULL OR v_booking.christmas_diner_count IS NOT NULL THEN
    RAISE EXCEPTION 'This booking already has Christmas dinner choices.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_booking.deposit_waived, false) THEN
    RAISE EXCEPTION 'A manager waived the deposit on this booking, so it cannot be changed to Christmas dinner here.' USING ERRCODE = '22023';
  END IF;
  -- A deposit already taken, owed or being paid has its own terms; changing them is not this step.
  IF v_booking.payment_status IS NOT NULL OR v_booking.deposit_amount IS NOT NULL
     OR v_booking.deposit_amount_locked IS NOT NULL OR v_booking.paypal_deposit_capture_id IS NOT NULL
     OR v_booking.paypal_deposit_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'This booking already has a deposit taken or asked for, so it cannot be changed to Christmas dinner here.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_period FROM public.get_booking_period_for_date(v_booking.booking_date);
  IF v_period.id IS NULL OR v_period.period_kind <> 'christmas' THEN
    RAISE EXCEPTION 'Christmas dinner is not on offer for %.', to_char(v_booking.booking_date, 'DD Mon YYYY') USING ERRCODE = '22023';
  END IF;
  -- The diners choose their food on the food link, which closes at noon preorder_cutoff_days before
  -- the date (christmas_course_policy_v01, getPreorderCutoff). Converted after that, the guest would
  -- get a read-only food page and the chase would escalate at once, so a manager rebooks it instead.
  IF v_period.requires_preorder AND v_period.preorder_cutoff_days IS NOT NULL
     AND now() >= (((v_booking.booking_date - v_period.preorder_cutoff_days) + time '12:00') AT TIME ZONE 'Europe/London') THEN
    RAISE EXCEPTION 'The Christmas food choices for this date have closed, so this booking cannot be changed to Christmas dinner here. A manager needs to rebook it.' USING ERRCODE = '22023';
  END IF;

  -- The Christmas minimum (CHRISTMAS_MIN_PARTY_SIZE, 4) counts the people having Christmas dinner.
  IF p_christmas_diners IS NULL OR p_christmas_diners < 4 THEN
    RAISE EXCEPTION 'Christmas dinner is for 4 or more people having it.' USING ERRCODE = '22023';
  END IF;
  IF p_christmas_diners > v_booking.party_size THEN
    RAISE EXCEPTION 'There cannot be more Christmas dinners (%) than seats on the booking (%).', p_christmas_diners, v_booking.party_size USING ERRCODE = '22023';
  END IF;

  -- The one rule that decides money, never a sum worked out here.
  v_deposit := public.resolve_table_booking_deposit_v02(
    v_booking.party_size, v_booking.booking_date, v_period.id, true, false, p_christmas_diners);
  IF NOT COALESCE((v_deposit ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION '%', CASE v_deposit ->> 'error_code'
      WHEN 'period_party_too_small' THEN 'Christmas dinner needs more people having it on that date.'
      WHEN 'period_party_too_large' THEN 'This party is larger than Christmas bookings allow.'
      WHEN 'period_menu_not_ready' THEN 'The Christmas menu has not been published yet.'
      ELSE format('The Christmas deposit could not be worked out (%s).', COALESCE(v_deposit ->> 'error_code', 'unknown'))
    END USING ERRCODE = '22023';
  END IF;
  v_amount := ROUND(COALESCE((v_deposit ->> 'amount')::numeric, 0), 2);
  -- The step exists to ask for the Christmas deposit in one message. With no deposit due (seasonal
  -- collection switched off) there is nothing to ask for, so the booking is left as it is.
  IF NOT COALESCE((v_deposit ->> 'required')::boolean, false) OR v_amount <= 0 THEN
    RAISE EXCEPTION 'No Christmas deposit is being taken at the moment (seasonal deposits are switched off in Settings), so the booking was not changed.' USING ERRCODE = '22023';
  END IF;

  -- The fields a fresh accepted Christmas booking carries (create_table_booking_core_v06), and the
  -- deposit owed on a booking that STAYS confirmed (applyPartySizeDepositTransition, D20): no hold
  -- row, nothing for the timeout cron (which only reads pending_payment) to cancel. hold_expires_at
  -- is how long the payment link and the PayPal capture accept the money: until the booking starts.
  UPDATE public.table_bookings
     SET booking_type = 'christmas'::public.table_booking_type,
         booking_period_id = v_period.id,
         booking_period_code = v_period.code,
         booking_period_name = v_period.name,
         booking_period_answer = true,
         booking_period_requires_preorder = v_period.requires_preorder,
         christmas_diner_count = p_christmas_diners,
         -- One entry per Christmas dinner, all "not chosen yet". The trigger fills only on insert.
         christmas_course_counts = array_fill(0, ARRAY[p_christmas_diners]),
         deposit_rule = v_deposit ->> 'rule',
         deposit_basis = v_deposit ->> 'basis',
         deposit_rate = NULLIF(v_deposit ->> 'rate', '')::numeric,
         deposit_amount = v_amount,
         deposit_refund_cutoff_days = NULLIF(v_deposit ->> 'refund_cutoff_days', '')::integer,
         deposit_refund_policy = v_deposit ->> 'refund_policy',
         payment_method = 'payment_link'::public.table_booking_payment_method,
         payment_status = 'pending'::public.payment_status,
         hold_expires_at = v_booking.start_datetime,
         paypal_deposit_order_id = NULL,
         internal_notes = CASE
           WHEN v_note IS NULL THEN internal_notes
           WHEN NULLIF(trim(COALESCE(internal_notes, '')), '') IS NULL THEN v_note
           ELSE internal_notes || E'\n' || v_note
         END,
         updated_at = now()
   WHERE id = p_booking_id
   RETURNING * INTO v_row;

  -- One pre-order seat per Christmas dinner, in the same transaction.
  v_covers := public.preorder_sync_covers(p_booking_id);

  RETURN jsonb_build_object(
    'ok', true,
    'table_booking_id', v_row.id,
    'booking_reference', v_row.booking_reference,
    'customer_id', v_row.customer_id,
    'status', v_row.status::text,
    'party_size', v_row.party_size,
    'christmas_diner_count', v_row.christmas_diner_count,
    'christmas_course_counts', to_jsonb(v_row.christmas_course_counts),
    'start_datetime', v_row.start_datetime,
    'hold_expires_at', v_row.hold_expires_at,
    'deposit_amount', v_amount,
    'deposit_rule', v_row.deposit_rule,
    'deposit_basis', v_row.deposit_basis,
    'deposit_rate', v_row.deposit_rate,
    'deposit_refund_cutoff_days', v_row.deposit_refund_cutoff_days,
    'booking_period_name', v_row.booking_period_name,
    'cover_count', v_covers -> 'cover_count'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_table_booking_to_christmas_v01(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_table_booking_to_christmas_v01(uuid, integer, text) TO service_role;
