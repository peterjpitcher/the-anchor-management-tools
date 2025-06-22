-- Add scheduled_for field to private_booking_sms_queue for automated sending
ALTER TABLE private_booking_sms_queue
ADD COLUMN scheduled_for timestamptz;

-- Add index for efficient querying of scheduled messages
CREATE INDEX idx_private_booking_sms_queue_scheduled_for 
ON private_booking_sms_queue(scheduled_for, status)
WHERE status IN ('pending', 'approved');

-- Add comment explaining the field
COMMENT ON COLUMN private_booking_sms_queue.scheduled_for IS 'When this message should be automatically sent. NULL means manual sending only.';

-- Update existing messages to have scheduled_for based on booking dates
-- This sets reminder messages to be sent 24 hours before the event
UPDATE private_booking_sms_queue sms
SET scheduled_for = (
    SELECT (pb.event_date || ' ' || pb.start_time)::timestamptz - INTERVAL '24 hours'
    FROM private_bookings pb
    WHERE pb.id = sms.booking_id
)
WHERE sms.trigger_type = 'reminder'
AND sms.status IN ('pending', 'approved')
AND sms.scheduled_for IS NULL;

-- For confirmation messages, schedule them to be sent immediately
UPDATE private_booking_sms_queue
SET scheduled_for = created_at
WHERE trigger_type IN ('status_change', 'manual')
AND status IN ('pending', 'approved')
AND scheduled_for IS NULL;