-- ============================================================================
-- Fix for Migration C (20260509000016): the legacy delegate
-- `create_table_booking_v05_core_sunday_deposit_legacy` is the original
-- pre-launch `_core` body. It applies the £10/person deposit + sets
-- `pending_payment` whenever `p_sunday_lunch = true`, regardless of party
-- size. Migration C only re-applies its own deposit logic for parties of
-- 10+, so a Sunday-lunch booking of 2 still flows through the legacy path
-- and ends up in `pending_payment` — contradicting the new 10+ rule.
--
-- Affected reviewers: ARCH-001 (integration-architecture), WF-001 (workflow),
-- SEC-001 (security-data-risk).
--
-- This migration replaces `_core` with a version that:
--   1. Calls the legacy delegate as before (preserves create-booking
--      behaviour, hold creation, etc.).
--   2. If the new 10+ rule says no deposit is required AND the legacy
--      delegate set `pending_payment`, neutralise the legacy deposit side
--      effects: cancel the table_deposit payment row, release the payment
--      hold, restore the booking to `status='confirmed'`,
--      `payment_status=NULL`, `payment_method=NULL`, `hold_expires_at=NULL`,
--      and rewrite the JSON result to `state='confirmed'`.
--   3. Otherwise (party >= 10), apply the existing Migration C escalation
--      verbatim.
--
-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
--           §8.4 Migration C corrective fix.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_table_booking_v05_core(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food',
  p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_state text := 'blocked';
  v_table_booking_id uuid;
  v_booking RECORD;
  v_now timestamptz := NOW();
  v_party_size integer := GREATEST(1, COALESCE(p_party_size, 1));
  v_booking_start timestamptz;
  v_hold_expires_at timestamptz;
  v_deposit_amount numeric(10, 2);
  v_payment_id uuid;
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core_sunday_deposit_legacy(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  v_result := public.create_table_booking_v05_core_sunday_deposit_legacy(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );

  -- New rule: deposit required ONLY for parties of 10+.
  IF NOT (COALESCE(p_party_size, 0) >= 10) THEN
    -- Below threshold: if the legacy delegate set pending_payment because
    -- p_sunday_lunch=true, neutralise that decision so the new rule wins.
    IF (v_result->>'state') = 'pending_payment' THEN
      v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
      IF v_table_booking_id IS NOT NULL THEN
        -- Mark the auto-created table_deposit payment row(s) as failed
        -- with cancellation metadata — `payments.status` does not allow
        -- 'cancelled' (CHECK constraint: pending/succeeded/failed/refunded/
        -- partially_refunded), so 'failed' is the correct neutral state for
        -- a deposit that should never have been opened. We never touch
        -- already-succeeded rows.
        UPDATE public.payments
        SET
          status = 'failed',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'cancelled_at', v_now,
            'cancelled_reason', 'walk_in_launch_below_threshold',
            'source', 'core_threshold_neutralise'
          )
        WHERE table_booking_id = v_table_booking_id
          AND charge_type = 'table_deposit'
          AND status = 'pending';

        -- Release the payment hold the legacy delegate created/refreshed.
        UPDATE public.booking_holds
        SET
          status = 'released',
          released_at = v_now,
          updated_at = v_now
        WHERE table_booking_id = v_table_booking_id
          AND hold_type = 'payment_hold'
          AND status = 'active';

        -- Restore the booking to a confirmed/no-deposit state.
        UPDATE public.table_bookings
        SET
          status = 'confirmed'::public.table_booking_status,
          confirmed_at = COALESCE(confirmed_at, v_now),
          hold_expires_at = NULL,
          payment_method = NULL,
          payment_status = NULL,
          updated_at = v_now
        WHERE id = v_table_booking_id;

        -- Rewrite the JSON result so callers see the corrected state.
        v_result := v_result
          - 'hold_expires_at'
          - 'payment_required'
          - 'deposit_per_person'
          - 'deposit_amount'
          - 'card_capture_required'
          || jsonb_build_object(
            'state', 'confirmed',
            'status', 'confirmed',
            'payment_required', false
          );
      END IF;
    END IF;
    RETURN v_result;
  END IF;

  -- Party 10+: apply the deposit escalation (same body as Migration C).
  v_state := COALESCE(v_result->>'state', 'blocked');
  IF v_state = 'blocked' THEN
    RETURN v_result;
  END IF;

  v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT
    tb.id,
    tb.status,
    tb.party_size,
    tb.committed_party_size,
    tb.booking_date,
    tb.booking_time,
    tb.start_datetime,
    tb.payment_method,
    tb.payment_status
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = v_table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  v_party_size := GREATEST(1, COALESCE(v_booking.committed_party_size, v_booking.party_size, p_party_size, 1));
  v_deposit_amount := ROUND((v_party_size::numeric) * 10.0, 2);
  v_booking_start := COALESCE(
    v_booking.start_datetime,
    ((v_booking.booking_date::text || ' ' || v_booking.booking_time::text)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_booking_start IS NULL OR v_booking_start <= v_now THEN
    v_hold_expires_at := v_now + INTERVAL '15 minutes';
  ELSE
    v_hold_expires_at := LEAST(v_booking_start, v_now + INTERVAL '24 hours');
  END IF;

  -- Defensive cleanup of any legacy card_capture_hold rows.
  UPDATE public.booking_holds
  SET
    status = 'released',
    released_at = v_now,
    updated_at = v_now
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'card_capture_hold'
    AND status = 'active';

  UPDATE public.booking_holds
  SET
    seats_or_covers_held = v_party_size,
    expires_at = v_hold_expires_at,
    updated_at = v_now,
    scheduled_sms_send_time = NULL,
    status = 'active',
    released_at = NULL,
    consumed_at = NULL
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'payment_hold'
    AND status = 'active';

  IF NOT FOUND THEN
    INSERT INTO public.booking_holds (
      hold_type,
      table_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_table_booking_id,
      v_party_size,
      'active',
      v_hold_expires_at,
      v_now,
      v_now
    );
  END IF;

  SELECT p.id
  INTO v_payment_id
  FROM public.payments p
  WHERE p.table_booking_id = v_table_booking_id
    AND p.charge_type = 'table_deposit'
    AND p.status IN ('pending', 'succeeded')
  ORDER BY p.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment_id IS NULL THEN
    INSERT INTO public.payments (
      table_booking_id,
      charge_type,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      v_table_booking_id,
      'table_deposit',
      v_deposit_amount,
      'GBP',
      'pending',
      jsonb_build_object(
        'source', 'table_booking_runtime',
        'deposit_per_person', 10,
        'party_size', v_party_size,
        'created_at', v_now
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  ELSE
    UPDATE public.payments
    SET
      amount = v_deposit_amount,
      currency = 'GBP',
      status = CASE WHEN status = 'succeeded' THEN status ELSE 'pending' END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'table_booking_runtime',
        'deposit_per_person', 10,
        'party_size', v_party_size,
        'updated_at', v_now
      )
    WHERE id = v_payment_id;
  END IF;

  UPDATE public.table_bookings
  SET
    status = 'pending_payment'::public.table_booking_status,
    confirmed_at = NULL,
    hold_expires_at = v_hold_expires_at,
    payment_method = 'payment_link'::public.table_booking_payment_method,
    payment_status = 'pending'::public.payment_status,
    updated_at = v_now
  WHERE id = v_table_booking_id;

  RETURN v_result || jsonb_build_object(
    'state', 'pending_payment',
    'status', 'pending_payment',
    'hold_expires_at', v_hold_expires_at,
    'card_capture_required', false,
    'payment_required', true,
    'deposit_per_person', 10,
    'deposit_amount', v_deposit_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;
