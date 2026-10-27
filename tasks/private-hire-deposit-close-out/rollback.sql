-- Rollback for supabase/migrations/20261027180212_private_hire_deposit_close_out.sql.
--
-- Puts the six backfilled bookings back as they were on 27 October 2026, then restores the refund
-- status check as 20261027180147 left it. A booking closed since the migration with one of the
-- three new values has that value cleared first (to NULL, with post-event 'awaiting_inspection'
-- so the close-out shows again), or the old check would refuse it: read
-- deposit_refund_status first if any were closed that way.

UPDATE public.private_bookings
SET deposit_refund_status = NULL,
    post_event_status = 'awaiting_inspection'
WHERE id IN (
    '3bc91aef-efe4-4c56-8c8f-a0974f69e72b',
    '6932f051-4e3b-406c-8fbf-e177f1461b66',
    'c28527fe-a373-460d-85a8-e509b78d6eba',
    'e17f83dc-7059-42c2-9525-91df4c1f7eb2',
    'f3870dc1-a605-42b6-a598-6335c21861a2'
  )
  AND deposit_refund_status = 'applied';

UPDATE public.private_bookings
SET post_event_status = 'awaiting_inspection'
WHERE id = '1d0cfced-b97c-4562-9735-dd798d5b32bb'
  AND post_event_status = 'complete';

UPDATE public.private_bookings
SET deposit_refund_status = NULL,
    post_event_status = 'awaiting_inspection'
WHERE deposit_refund_status IN ('retained', 'partially_retained', 'applied');

ALTER TABLE public.private_bookings
  DROP CONSTRAINT private_bookings_deposit_refund_status_check;
ALTER TABLE public.private_bookings
  ADD CONSTRAINT private_bookings_deposit_refund_status_check
  CHECK (deposit_refund_status = ANY (ARRAY['partially_refunded'::text, 'refunded'::text, 'refund_due'::text]));
