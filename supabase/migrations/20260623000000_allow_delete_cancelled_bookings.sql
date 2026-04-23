-- Allow hard-delete of cancelled private bookings.
--
-- The original prevent_hard_delete_when_sms_sent() trigger blocks deletion
-- when SMS has been sent, telling the admin to "cancel instead". But for
-- bookings that are already cancelled, the customer has been notified —
-- the SMS gate should not prevent cleanup.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_hard_delete_when_sms_sent()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow deletion of cancelled bookings — customer already notified
  IF OLD.status = 'cancelled' THEN
    RETURN OLD;
  END IF;

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

COMMENT ON FUNCTION prevent_hard_delete_when_sms_sent() IS
  'Blocks hard-delete of private_bookings that have sent or scheduled-future SMS. '
  'Rule: cancelled bookings are always deletable; status=sent blocks; '
  'status=approved AND scheduled_for>now() blocks. '
  'Other statuses (pending/cancelled/failed) do NOT block.';

COMMIT;
