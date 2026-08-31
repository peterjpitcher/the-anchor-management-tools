-- Clear cancellation timestamps from bookings that are not cancelled.
--
-- Cancelling a booking stamps `cancelled_at`. Reinstating one moved `status`
-- back but left the timestamp behind, because nothing ever cleared it. Three
-- live confirmed bookings were carrying a cancellation date from months
-- earlier, which blocked invoicing:
--
--   Lisa Andrew      event 2026-09-03, stamped 2026-02-16
--   Chloe Weightman  event 2026-09-24, stamped 2026-06-03
--   Lorna Wright     event 2026-11-21, stamped 2026-06-03
--
-- Scoped by `status <> 'cancelled'` rather than by id, so it also catches any
-- row that drifted between this being written and being applied. Genuinely
-- cancelled bookings keep their timestamp and reason: that is the record of
-- when the cancellation happened and must not be touched.

UPDATE public.private_bookings
   SET cancelled_at = NULL,
       cancellation_reason = NULL,
       cancellation_channel = NULL,
       cancellation_received_at = NULL,
       cancelled_by = NULL
 WHERE status <> 'cancelled'
   AND cancelled_at IS NOT NULL;
