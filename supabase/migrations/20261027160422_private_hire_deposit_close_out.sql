-- Closing a private hire's deposit after the event (BK-062, customer bookings review of
-- 24 October 2026).
--
-- Nothing let staff record what happened to the security deposit after a hire, and a kept
-- deposit could not be stored at all: the refund status allowed only 'partially_refunded' and
-- 'refunded' (and 'refund_due' since 20261027160421). The nightly job marked every past paid
-- deposit 'awaiting_inspection' and nothing cleared it, even after a refund.
--
-- 1. Three more refund status values: 'retained' (all kept, with a reason), 'partially_retained'
--    (part kept and the rest refunded), and 'applied' (put against the final bill).
-- 2. Six past bookings whose deposit outcome is already known are closed:
--    - five whose deposit an invoice applied to the bill (invoice_deposit_treatment 'deducted')
--      become 'applied' and post-event 'complete';
--    - one whose deposit was refunded in full becomes post-event 'complete'.
--    Each update names its booking and the state it must still be in, so a row that has moved
--    on since 27 October 2026 is left alone. The 18 other open deposits are for the owner to
--    close from their own records (owner decision D27); this migration does not touch them.
--
-- No function or view reads these columns. Apply before the code that writes the new values.

ALTER TABLE public.private_bookings
  DROP CONSTRAINT private_bookings_deposit_refund_status_check;
ALTER TABLE public.private_bookings
  ADD CONSTRAINT private_bookings_deposit_refund_status_check
  CHECK (deposit_refund_status = ANY (ARRAY[
    'partially_refunded'::text, 'refunded'::text, 'refund_due'::text,
    'retained'::text, 'partially_retained'::text, 'applied'::text
  ]));

UPDATE public.private_bookings
SET deposit_refund_status = 'applied',
    post_event_status = 'complete'
WHERE id IN (
    '3bc91aef-efe4-4c56-8c8f-a0974f69e72b',
    '6932f051-4e3b-406c-8fbf-e177f1461b66',
    'c28527fe-a373-460d-85a8-e509b78d6eba',
    'e17f83dc-7059-42c2-9525-91df4c1f7eb2',
    'f3870dc1-a605-42b6-a598-6335c21861a2'
  )
  AND invoice_deposit_treatment = 'deducted'
  AND deposit_refund_status IS NULL
  AND post_event_status = 'awaiting_inspection';

UPDATE public.private_bookings
SET post_event_status = 'complete'
WHERE id = '1d0cfced-b97c-4562-9735-dd798d5b32bb'
  AND deposit_refund_status = 'refunded'
  AND post_event_status = 'awaiting_inspection';
