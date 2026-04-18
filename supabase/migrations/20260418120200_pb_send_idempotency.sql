-- supabase/migrations/20260418120200_pb_send_idempotency.sql
--
-- Phase 1, Task 1.3 — Private Bookings SMS Redesign
-- Creates the private_booking_send_idempotency table. This stores stable
-- business idempotency keys of the form {booking_id}:{trigger_type}:{window_key}
-- so cron-driven private-booking SMS cannot be duplicated when a copy refresh
-- invalidates the body-hash dedupe lock in SmsQueueService.
--
-- Access is service-role only; no UI ever reads this table.
BEGIN;

CREATE TABLE private_booking_send_idempotency (
  idempotency_key text PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES private_bookings(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  window_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pb_send_idemp_booking ON private_booking_send_idempotency(booking_id);
CREATE INDEX idx_pb_send_idemp_created ON private_booking_send_idempotency(created_at);

COMMENT ON TABLE private_booking_send_idempotency IS
  'Stable business idempotency keys for cron-driven private-booking SMS. '
  'Key format: {booking_id}:{trigger_type}:{window_key}. '
  'Independent of message body so copy refresh does not cause duplicate sends.';

-- RLS: service-role only.
ALTER TABLE private_booking_send_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON private_booking_send_idempotency
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;
