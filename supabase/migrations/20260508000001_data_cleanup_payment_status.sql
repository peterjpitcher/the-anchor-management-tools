-- Fix stale payment_status records from legacy manager booking flow

BEGIN;

-- Ensure cancel-related columns exist on table_bookings
-- (cancellation_reason already added; cancelled_by may be missing from live DB)
ALTER TABLE table_bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by text;

-- 1. Confirmed bookings where no deposit was required but payment_status is incorrectly 'pending'
--    Conditions: confirmed, payment_status = pending, party_size < 7, not a Sunday, no payments record
UPDATE table_bookings
SET
  payment_status = NULL,
  updated_at = NOW()
WHERE
  status = 'confirmed'
  AND payment_status = 'pending'
  AND party_size < 7
  AND EXTRACT(DOW FROM booking_date) != 0
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.table_booking_id = table_bookings.id
  );

-- 2. Past bookings stuck in pending_payment — deposit required but never paid, booking date passed
UPDATE table_bookings
SET
  status = 'cancelled',
  cancelled_at = NOW(),
  cancelled_by = 'system',
  cancellation_reason = 'deposit_never_paid_booking_passed',
  updated_at = NOW()
WHERE
  status = 'pending_payment'
  AND booking_date < CURRENT_DATE;

COMMIT;
