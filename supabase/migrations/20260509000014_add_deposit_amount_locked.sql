-- ============================================================================
-- Migration A: deposit lock column + legacy unpaid pending conversion + paid backfill.
-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
--           §7.4 (lock-amount design), §8.4 Migration A (full SQL spec).
-- D6 verified (28 April 2026): the only paid value of payments.status for
--   charge_type='table_deposit' is 'succeeded'. This SQL uses status='succeeded'.
-- D11 verified (28 April 2026): 0 future unpaid pending Sunday-lunch bookings,
--   1 future paid (TB-8229A1B4 / Sun 31 May 2026, party 1, £10 deposit). Step 1
--   is a defensive no-op on day 1; Step 2 will lock the 1 paid row + any history.
-- ============================================================================

-- Add the lock column. Additive, no defaults — existing rows are NULL.
ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_amount_locked numeric NULL;

COMMENT ON COLUMN public.table_bookings.deposit_amount_locked IS
  'Locked deposit amount in GBP. Set by every successful payment-capture surface (PayPal capture-order, Stripe webhook, cash/manual deposit confirmation) and by the Migration A backfill. Once set it is immutable — paid bookings always read the canonical amount from this column. NULL means no payment has been captured for this booking yet.';

-- ============================================================================
-- STEP 1 (legacy unpaid pending conversion, per OQ14a resolution):
-- For legacy sunday_lunch bookings that have not captured a payment AND whose
-- service date is in the future, convert them to regular bookings under the new
-- rules. Pre-order data on the row is preserved (in table_booking_items /
-- special_requirements) but is no longer kitchen-enforced.
--
-- IMPORTANT — only touch FUTURE bookings. Historical abandoned/past
-- pending_payment rows must not be rewritten (would pollute reporting and
-- historical state).
--
-- IMPORTANT — staff review list MUST be generated and signed off before this
-- UPDATE runs (see §8.4 Pre-conversion review).
--
-- Below 10: drop pending_payment status (becomes confirmed); deposit no longer
--           required.
-- 10+:      keep pending_payment (deposit still required under new rules);
--           deposit_amount stays.
-- ============================================================================
UPDATE public.table_bookings tb
SET
  booking_type = 'regular',
  status = CASE WHEN tb.party_size >= 10 THEN tb.status ELSE 'confirmed' END,
  deposit_amount = CASE WHEN tb.party_size >= 10 THEN tb.deposit_amount ELSE NULL END
WHERE tb.booking_type = 'sunday_lunch'
  AND tb.status = 'pending_payment'
  AND tb.start_datetime >= NOW()  -- ONLY future-dated bookings
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.table_booking_id = tb.id
      AND p.charge_type = 'table_deposit'
      AND p.status = 'succeeded'
  )
  AND tb.paypal_deposit_capture_id IS NULL
  AND COALESCE(tb.payment_status::text, '') <> 'completed';  -- NULL-safe

-- ============================================================================
-- STEP 2 (paid-deposit backfill):
-- Lock the captured deposit amount for any booking with paid evidence.
-- Sources, in priority order:
--   1. payments.amount where charge_type='table_deposit' AND status='succeeded'
--      (latest by created_at via DISTINCT ON)
--   2. table_bookings.deposit_amount fallback (legacy rows where the payments
--      record may be missing but deposit_amount was set on the booking row)
--
-- The outer WHERE clause guards against locking a NULL value when neither
-- source has a usable amount.
-- ============================================================================
WITH paid_payments AS (
  SELECT DISTINCT ON (p.table_booking_id)
    p.table_booking_id,
    p.amount
  FROM public.payments p
  WHERE p.charge_type = 'table_deposit'
    AND p.status = 'succeeded'
  ORDER BY p.table_booking_id, p.created_at DESC
)
UPDATE public.table_bookings tb
SET deposit_amount_locked = COALESCE(
  (SELECT amount FROM paid_payments pp WHERE pp.table_booking_id = tb.id),
  tb.deposit_amount
)
WHERE tb.deposit_amount_locked IS NULL
  AND (
    COALESCE(tb.payment_status::text, '') = 'completed'
    OR tb.paypal_deposit_capture_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM paid_payments pp WHERE pp.table_booking_id = tb.id)
  )
  AND COALESCE(
    (SELECT amount FROM paid_payments pp WHERE pp.table_booking_id = tb.id),
    tb.deposit_amount
  ) IS NOT NULL;

-- ============================================================================
-- STEP 3 — Verification report (zero rows on success). Run as a sanity check.
-- Any row returned indicates a paid booking that backfill couldn't lock — flag
-- for staff review BEFORE the launch banner activates.
-- Acceptance criterion (§8.10): zero rows here, OR a written sign-off from the
-- owner explicitly listing the rows and the reason they remain unlocked.
-- ============================================================================
-- This SELECT does not run as part of the migration; it's the script you run
-- post-migration to verify integrity. Copy into the SQL editor:
/*
SELECT tb.id, tb.booking_reference, tb.start_datetime, tb.party_size,
       tb.payment_status, tb.paypal_deposit_capture_id, tb.deposit_amount, tb.deposit_amount_locked
FROM public.table_bookings tb
WHERE tb.deposit_amount_locked IS NULL
  AND (
    tb.payment_status::text = 'completed'
    OR tb.paypal_deposit_capture_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.payments p
               WHERE p.table_booking_id = tb.id
                 AND p.charge_type = 'table_deposit'
                 AND p.status = 'succeeded')
  );
*/
