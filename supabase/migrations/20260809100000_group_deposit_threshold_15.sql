-- Raise the standard table-booking group deposit threshold from 10 guests to 15.
--
-- WHY: a party of ten is an ordinary Sunday family group, not a risk. Asking them to
-- pay up front is the most likely reason the pub took two bookings of ten or more in
-- ninety days. The per-head rate is unchanged at GBP 10, and the seasonal (Christmas)
-- deposit is deliberately untouched.
--
-- PRIVATE HIRE IS NOT AFFECTED. Private-hire deposits live entirely in the
-- private_bookings tables and their own functions. No function that reads
-- private_bookings references the constant changed here, which was checked against
-- pg_get_functiondef across the whole public schema before this migration was written.
--
-- Two objects carry the number:
--   1. resolve_table_booking_deposit  - the ONE function that decides money. Rewritten
--      in full below so the file stays the readable source of truth, because
--      src/lib/table-bookings/create-path-deposit.test.ts parses this text and asserts
--      it matches LARGE_GROUP_DEPOSIT_THRESHOLD in TypeScript.
--   2. create_event_table_reservation_v05 - a deposit-state CLEANUP guard, not a
--      charging rule. It is 13KB of unrelated logic, so rather than retype it and risk
--      a transcription error in a money path, the guard is patched surgically below
--      with an assertion that exactly the two expected occurrences were found.

BEGIN;

-- 1. THE FUNCTION THAT DECIDES MONEY -----------------------------------------------
-- Identical to the definition introduced by 20260803000100_seasonal_booking_periods.sql
-- except for c_group_threshold, which moves from 10 to 15.

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

-- 2. THE EVENT-PATH CLEANUP GUARD ---------------------------------------------------
-- create_event_table_reservation_v05 calls neutralise_under10_table_deposit_state_v01
-- when it confirms a reservation below the threshold, to clear any deposit state the
-- booking should not be carrying. It hardcodes the old number in two places. Left at
-- 10 it would simply stop firing for parties of 10 to 14, which is the exact kind of
-- silent drift the deposit helper's own doc comment warns about.
--
-- Patched from the live definition rather than retyped, and the migration refuses to
-- proceed unless it finds precisely the two occurrences it expects. Re-running after a
-- successful apply finds zero and exits quietly, so this is safe to replay.

DO $patch$
DECLARE
  v_src   text;
  v_hits  integer;
  v_token constant text := 'p_party_size < 10';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_event_table_reservation_v05';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'create_event_table_reservation_v05 not found: refusing to guess';
  END IF;

  v_hits := (length(v_src) - length(replace(v_src, v_token, ''))) / length(v_token);

  IF v_hits = 0 THEN
    RAISE NOTICE 'create_event_table_reservation_v05 already on the new threshold, nothing to do';
    RETURN;
  END IF;

  IF v_hits <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 occurrences of "%" in create_event_table_reservation_v05, found %. '
      'The function has changed shape: patch it by hand rather than trusting this migration.',
      v_token, v_hits;
  END IF;

  EXECUTE replace(v_src, v_token, 'p_party_size < 15');
END;
$patch$;

COMMIT;
