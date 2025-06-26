-- Fix draft booking that was expecting tentative status option
-- Since tentative status has been removed, update the booking to confirmed

-- First, let's see what draft bookings exist
DO $$
DECLARE
    draft_count INTEGER;
BEGIN
    -- Count draft bookings
    SELECT COUNT(*) INTO draft_count
    FROM private_bookings 
    WHERE status = 'draft';
    
    -- Log the count
    RAISE NOTICE 'Found % draft bookings', draft_count;
END $$;

-- Update any draft bookings to confirmed status
-- This is safe because the user indicated they want to confirm the booking
UPDATE private_bookings 
SET 
    status = 'confirmed',
    updated_at = NOW()
WHERE status = 'draft';

-- Also queue SMS notifications for any bookings we just confirmed
INSERT INTO private_booking_sms_queue (
    booking_id,
    trigger_type,
    recipient_phone,
    message_body,
    status,
    created_at,
    created_by,
    metadata
)
SELECT 
    pb.id,
    'status_change',
    pb.contact_phone,
    'Your private booking at The Anchor on ' || 
    TO_CHAR(pb.event_date, 'DD/MM/YYYY') || 
    ' has been confirmed. We look forward to hosting your event!',
    'pending',
    NOW(),
    pb.created_by,
    jsonb_build_object(
        'previous_status', 'draft',
        'new_status', 'confirmed',
        'auto_updated', true
    )
FROM private_bookings pb
WHERE pb.status = 'confirmed' 
  AND pb.contact_phone IS NOT NULL
  AND pb.updated_at >= NOW() - INTERVAL '1 minute' -- Only for bookings we just updated
  AND NOT EXISTS (
      -- Don't create duplicate SMS for this booking
      SELECT 1 
      FROM private_booking_sms_queue sms 
      WHERE sms.booking_id = pb.id 
        AND sms.trigger_type = 'status_change'
        AND sms.created_at >= NOW() - INTERVAL '1 minute'
  );

-- Log what we did
DO $$
DECLARE
    updated_count INTEGER;
    sms_count INTEGER;
BEGIN
    -- Count how many bookings were updated
    SELECT COUNT(*) INTO updated_count
    FROM private_bookings 
    WHERE status = 'confirmed' 
      AND updated_at >= NOW() - INTERVAL '1 minute';
    
    -- Count how many SMS were queued
    SELECT COUNT(*) INTO sms_count
    FROM private_booking_sms_queue
    WHERE trigger_type = 'status_change'
      AND created_at >= NOW() - INTERVAL '1 minute';
    
    RAISE NOTICE 'Updated % bookings from draft to confirmed', updated_count;
    RAISE NOTICE 'Queued % SMS notifications', sms_count;
END $$;