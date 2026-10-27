-- Rollback for supabase/migrations/20261027011052_private_hire_refunds_owed.sql.
--
-- Restores production as it was on 26 October 2026: no refund owed columns, and the refund status
-- check allowing only 'partially_refunded' and 'refunded'. A booking marked 'refund_due' since the
-- migration has that mark cleared first, or the old check would refuse it; the refund owed it
-- recorded is lost with the columns, so read refund_due_amount and refund_due_by first if any
-- booking still owes a refund.

UPDATE public.private_bookings
SET deposit_refund_status = NULL
WHERE deposit_refund_status = 'refund_due';

ALTER TABLE public.private_bookings
  DROP CONSTRAINT private_bookings_deposit_refund_status_check;
ALTER TABLE public.private_bookings
  ADD CONSTRAINT private_bookings_deposit_refund_status_check
  CHECK (deposit_refund_status = ANY (ARRAY['partially_refunded'::text, 'refunded'::text]));

ALTER TABLE public.private_bookings
  DROP CONSTRAINT private_bookings_refund_due_amount_check;

ALTER TABLE public.private_bookings
  DROP COLUMN refund_due_by,
  DROP COLUMN refund_due_amount;
