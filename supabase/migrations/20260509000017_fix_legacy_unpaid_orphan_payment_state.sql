-- ============================================================================
-- Fix-up for Migration A (20260509000014) Step 1: clear orphan payment state.
--
-- Migration A converted future unpaid `sunday_lunch` `pending_payment` bookings
-- with party_size < 10 to `booking_type='regular'`, `status='confirmed'`,
-- `deposit_amount=NULL` — but it left two related fields intact:
--
--   • `payment_status='pending'` — downstream code that filters on
--     `payment_status='pending'` (e.g. payment-cleanup cron, "deposit owed"
--     dashboards, payment-recovery SMS) will still treat the booking as
--     half-finished even though the new rules say no deposit is required.
--
--   • `paypal_deposit_order_id` — a stale PayPal order ID that should have
--     been invalidated when the deposit requirement was removed. Until cleared
--     it can be reused (see SEC-002 / ARCH-002 / WF-002).
--
-- This migration is **idempotent**: it only updates rows still in the orphan
-- state described in §8.4 Migration A Step 1 — converted-but-payment-state-
-- not-cleared bookings. Running it twice is a no-op.
--
-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
--           §8.4 Migration A — orphan-payment-state corrective fix.
-- ============================================================================
UPDATE public.table_bookings tb
SET
  payment_status = NULL,
  paypal_deposit_order_id = NULL,
  updated_at = NOW()
WHERE tb.booking_type = 'regular'
  AND tb.status = 'confirmed'
  AND tb.payment_status = 'pending'
  AND tb.deposit_amount IS NULL
  AND tb.start_datetime >= NOW()
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.table_booking_id = tb.id
      AND p.charge_type = 'table_deposit'
      AND p.status = 'succeeded'
  );

-- Verification SELECT (commented out — uncomment to inspect):
-- SELECT id, booking_reference, party_size, status, payment_status,
--        deposit_amount, paypal_deposit_order_id, start_datetime
-- FROM public.table_bookings
-- WHERE booking_type = 'regular'
--   AND status = 'confirmed'
--   AND deposit_amount IS NULL
--   AND payment_status IS NULL
--   AND start_datetime >= NOW();
