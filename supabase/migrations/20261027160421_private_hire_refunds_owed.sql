-- Refunds promised when a private hire is cancelled (BK-065, customer bookings review of
-- 24 October 2026).
--
-- A cancellation with money due back tells the guest "we'll refund £X within 10 working days", but
-- nothing on the booking recorded that a refund was owed, or by when, so a promised refund could be
-- forgotten with nothing to remind anyone. cancelBooking now writes the amount and the date here and
-- marks the booking's refund as due; the booking page, the dashboard and the manager's daily email
-- list it until the refunds recorded against the booking cover it.
--
-- Adds two nullable columns and one allowed value. No row is changed, no function or view reads
-- these columns, and the table's grants and row-level security cover the new columns as they cover
-- the rest. Apply before the code that writes them.

ALTER TABLE public.private_bookings
  ADD COLUMN refund_due_amount numeric(10,2),
  ADD COLUMN refund_due_by date;

ALTER TABLE public.private_bookings
  ADD CONSTRAINT private_bookings_refund_due_amount_check
  CHECK (refund_due_amount IS NULL OR refund_due_amount >= 0);

COMMENT ON COLUMN public.private_bookings.refund_due_amount IS
  'What a cancellation promised to refund the guest (BK-065). Owed until the completed refunds recorded against the booking reach it.';
COMMENT ON COLUMN public.private_bookings.refund_due_by IS
  'The London date the cancellation refund was promised by: 10 working days after the cancellation (BK-065).';

-- 'refund_due': a refund has been promised and not yet recorded. The two existing values stay.
ALTER TABLE public.private_bookings
  DROP CONSTRAINT private_bookings_deposit_refund_status_check;
ALTER TABLE public.private_bookings
  ADD CONSTRAINT private_bookings_deposit_refund_status_check
  CHECK (deposit_refund_status = ANY (ARRAY['partially_refunded'::text, 'refunded'::text, 'refund_due'::text]));
