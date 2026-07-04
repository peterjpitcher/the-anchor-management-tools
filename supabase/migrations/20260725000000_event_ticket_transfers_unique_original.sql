-- Make the staff transfer dedup guard atomic: at most one live (pending or
-- completed) transfer per original booking, enforced by the database rather
-- than the application's check-then-act pre-read.
--
-- Note: 20260616000002_event_ticket_paypal_payments.sql already declares this
-- index; this migration re-asserts it idempotently so environments migrated
-- before that file gained the index (or restored without it) are guaranteed
-- to have it. No-op where it already exists.

CREATE UNIQUE INDEX IF NOT EXISTS event_ticket_transfers_once_per_original_idx
  ON public.event_ticket_transfers (original_booking_id)
  WHERE status IN ('pending', 'completed');
