-- supabase/migrations/20260418120300_pb_delete_gate_trigger.sql
--
-- Phase 1, Task 1.4 — Private Bookings SMS Redesign
-- Adds a BEFORE DELETE trigger on private_bookings that blocks hard-delete
-- when the booking has sent or scheduled-future SMS in the queue.
--
-- Rule:
--   status='sent'                                     -> block
--   status='approved' AND scheduled_for IS NOT NULL
--     AND scheduled_for > now()                       -> block
--   any other status (pending/cancelled/failed/...)   -> allow
--
-- The server-action cancelBooking path (Phase 5) is the primary UX for
-- removing bookings. This trigger is defence-in-depth against direct SQL,
-- ad-hoc RPCs, or future code paths that might bypass the guard.
BEGIN;

CREATE OR REPLACE FUNCTION prevent_hard_delete_when_sms_sent()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private_booking_sms_queue
    WHERE booking_id = OLD.id
      AND (status = 'sent'
           OR (status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for > now()))
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: SMS already sent or scheduled. Use cancelBooking instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER private_bookings_delete_gate
  BEFORE DELETE ON private_bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete_when_sms_sent();

COMMENT ON FUNCTION prevent_hard_delete_when_sms_sent() IS
  'Blocks hard-delete of private_bookings that have sent or scheduled-future SMS. '
  'Rule: status=sent blocks; status=approved AND scheduled_for>now() blocks. '
  'Other statuses (pending/cancelled/failed) do NOT block.';

COMMIT;
