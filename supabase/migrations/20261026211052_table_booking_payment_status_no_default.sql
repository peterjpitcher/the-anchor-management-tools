-- BK-050 (customer bookings review of 24 October 2026): a booking written without a payment status
-- no longer reads as owing a deposit.
--
-- table_bookings.payment_status defaulted to 'pending'. The FOH walk-in fallback and the super admin
-- override insert a booking directly and never named a payment status, so every one of them was
-- saved as 'deposit pending'. For a walk-in that is only misleading data; for an override of 15 or
-- more (or a Christmas party) the booking then read as owing a deposit and could not be seated or
-- confirmed (src/lib/foh/bookings.ts hasUnpaidRequiredDeposit). The route now sets it explicitly;
-- this removes the default that caused it, so a missing payment status is NULL: nothing owed.
--
-- status loses its 'pending_payment' default for the same reason. Every writer names a status (the
-- four booking functions that insert, read from production on 26 October 2026, and the FOH insert),
-- so the default was never used on purpose; a writer that forgets now fails loudly instead of
-- creating a booking that looks unpaid.
--
-- The backfill clears 'pending' from walk-in and override bookings (references TB-W...) that never
-- had money: no PayPal capture, no locked deposit, no payments row. On 26 October 2026 that was 15
-- rows (13 confirmed walk-ins, 1 completed, 1 cancelled 20-person management override), none on a
-- future date. Their updated_at moves with the update (table_bookings_updated_at).
--
-- Rollback: tasks/table-booking-payment-status-no-default/rollback.sql.

ALTER TABLE public.table_bookings ALTER COLUMN payment_status DROP DEFAULT;
ALTER TABLE public.table_bookings ALTER COLUMN status DROP DEFAULT;

DO $backfill$
DECLARE
  v_cleared integer;
BEGIN
  UPDATE public.table_bookings tb
     SET payment_status = NULL
   WHERE tb.booking_reference LIKE 'TB-W%'
     AND tb.payment_status = 'pending'
     AND tb.paypal_deposit_capture_id IS NULL
     AND tb.deposit_amount_locked IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.table_booking_id = tb.id);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RAISE NOTICE 'table_booking_payment_status_no_default: cleared pending from % walk-in and override bookings', v_cleared;

  IF EXISTS (
    SELECT 1 FROM public.table_bookings tb
     WHERE tb.booking_reference LIKE 'TB-W%'
       AND tb.payment_status = 'pending'
       AND tb.paypal_deposit_capture_id IS NULL
       AND tb.deposit_amount_locked IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.table_booking_id = tb.id)
  ) THEN
    RAISE EXCEPTION 'table_booking_payment_status_no_default: a moneyless walk-in booking still reads as pending';
  END IF;
END
$backfill$;
