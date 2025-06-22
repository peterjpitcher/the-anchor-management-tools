-- Migration to enhance private booking SMS system for comprehensive notifications

-- 1. Update the trigger_type constraint to include new types
ALTER TABLE private_booking_sms_queue 
DROP CONSTRAINT IF EXISTS private_booking_sms_queue_trigger_type_check;

ALTER TABLE private_booking_sms_queue 
ADD CONSTRAINT private_booking_sms_queue_trigger_type_check 
CHECK (trigger_type IN (
  'status_change',
  'deposit_received',
  'payment_received',
  'final_payment_received',
  'reminder',
  'payment_due',
  'urgent',
  'manual',
  'booking_created',
  'date_changed',
  'booking_cancelled',
  'event_reminder_14d',
  'event_reminder_1d',
  'balance_reminder',
  'setup_reminder'
));

-- 2. Add missing columns for better tracking
ALTER TABLE private_booking_sms_queue 
ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
ADD COLUMN IF NOT EXISTS skip_conditions JSONB;

-- 3. Update existing data to use recipient_phone from customer_phone
UPDATE private_booking_sms_queue 
SET recipient_phone = customer_phone 
WHERE recipient_phone IS NULL AND customer_phone IS NOT NULL;

-- 4. Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sms_queue_scheduled_status 
ON private_booking_sms_queue(scheduled_for, status) 
WHERE status IN ('pending', 'approved');

-- Create a function to extract date in UTC (immutable)
CREATE OR REPLACE FUNCTION date_utc(timestamptz) 
RETURNS date AS $$
  SELECT DATE($1 AT TIME ZONE 'UTC');
$$ LANGUAGE SQL IMMUTABLE;

CREATE INDEX IF NOT EXISTS idx_sms_queue_booking_daily 
ON private_booking_sms_queue(booking_id, recipient_phone, date_utc(created_at));

CREATE INDEX IF NOT EXISTS idx_sms_queue_priority 
ON private_booking_sms_queue(priority, created_at) 
WHERE status = 'pending';

-- 5. Create a function to check if SMS should be sent (deduplication)
CREATE OR REPLACE FUNCTION should_send_private_booking_sms(
  p_booking_id UUID,
  p_phone TEXT,
  p_priority INTEGER,
  p_trigger_type TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_last_sms RECORD;
  v_today DATE;
BEGIN
  v_today := CURRENT_DATE;
  
  -- Get the last SMS sent today to this phone for this booking
  SELECT * INTO v_last_sms
  FROM private_booking_sms_queue
  WHERE booking_id = p_booking_id
    AND recipient_phone = p_phone
    AND date_utc(created_at) = v_today
    AND status IN ('pending', 'approved', 'sent')
  ORDER BY priority ASC, created_at DESC
  LIMIT 1;
  
  -- If no SMS today, allow sending
  IF v_last_sms IS NULL THEN
    RETURN TRUE;
  END IF;
  
  -- If new message has higher priority (lower number), allow sending
  IF p_priority < v_last_sms.priority THEN
    RETURN TRUE;
  END IF;
  
  -- Otherwise, don't send
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 6. Create a function to queue SMS with deduplication
CREATE OR REPLACE FUNCTION queue_private_booking_sms(
  p_booking_id UUID,
  p_trigger_type TEXT,
  p_template_key TEXT,
  p_message_body TEXT,
  p_recipient_phone TEXT,
  p_customer_name TEXT,
  p_priority INTEGER DEFAULT 3,
  p_scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  p_metadata JSONB DEFAULT '{}',
  p_skip_conditions JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_sms_id UUID;
BEGIN
  -- Check if we should send this SMS
  IF NOT should_send_private_booking_sms(p_booking_id, p_recipient_phone, p_priority, p_trigger_type) THEN
    RAISE NOTICE 'SMS not queued: Daily limit reached or lower priority than existing message';
    RETURN NULL;
  END IF;
  
  -- Insert the SMS
  INSERT INTO private_booking_sms_queue (
    booking_id,
    trigger_type,
    template_key,
    message_body,
    recipient_phone,
    customer_name,
    priority,
    scheduled_for,
    metadata,
    skip_conditions,
    status
  ) VALUES (
    p_booking_id,
    p_trigger_type,
    p_template_key,
    p_message_body,
    p_recipient_phone,
    p_customer_name,
    p_priority,
    p_scheduled_for,
    p_metadata,
    p_skip_conditions,
    'pending'
  ) RETURNING id INTO v_sms_id;
  
  RETURN v_sms_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Update message_templates constraint to allow private booking types
ALTER TABLE message_templates 
DROP CONSTRAINT IF EXISTS message_templates_template_type_check;

ALTER TABLE message_templates 
ADD CONSTRAINT message_templates_template_type_check 
CHECK (template_type IN (
  -- Existing types
  'booking_confirmation',
  'reminder_7_day',
  'reminder_24_hour',
  'booking_reminder_confirmation',
  'booking_reminder_7_day',
  'booking_reminder_24_hour',
  'custom',
  -- New private booking types
  'private_booking_created',
  'private_booking_deposit_received',
  'private_booking_final_payment',
  'private_booking_reminder_14d',
  'private_booking_balance_reminder',
  'private_booking_reminder_1d',
  'private_booking_date_changed',
  'private_booking_confirmed',
  'private_booking_cancelled'
));

-- Now delete any existing private booking templates
DELETE FROM message_templates WHERE template_type LIKE 'private_booking_%';

-- Insert new templates
INSERT INTO message_templates (template_type, name, content, variables) VALUES
('private_booking_created', 'Private Booking Enquiry', 'Hi {{first_name}}, thank you for your enquiry about private hire at The Anchor on {{event_date}}. To secure this date, a deposit of £{{deposit_amount}} is required. Reply to this message with any questions.', '{"first_name", "event_date", "deposit_amount"}'::text[]),
('private_booking_deposit_received', 'Private Booking Deposit Received', 'Hi {{first_name}}, we''ve received your deposit of £{{amount}}. Your private booking on {{event_date}} is now secured. Reply to this message with any questions.', '{"first_name", "amount", "event_date"}'::text[]),
('private_booking_final_payment', 'Private Booking Final Payment', 'Hi {{first_name}}, thank you for your final payment. Your private booking on {{event_date}} is fully paid. Reply to this message with any questions.', '{"first_name", "event_date"}'::text[]),
('private_booking_reminder_14d', 'Private Booking 14 Day Reminder', 'Hi {{first_name}}, your private event at The Anchor is coming up on {{event_date}} at {{start_time}} for {{guest_count}} guests. Reply to this message with any questions.', '{"first_name", "event_date", "start_time", "guest_count"}'::text[]),
('private_booking_balance_reminder', 'Private Booking Balance Reminder', 'Hi {{first_name}}, reminder: the balance for your event on {{event_date}} is due by {{balance_due_date}}. Reply to this message with any questions.', '{"first_name", "event_date", "balance_due_date"}'::text[]),
('private_booking_reminder_1d', 'Private Booking Tomorrow', 'Hi {{first_name}}, looking forward to hosting your event tomorrow at {{start_time}}. Everything is prepared for your {{guest_count}} guests. Reply to this message with any questions.', '{"first_name", "start_time", "guest_count"}'::text[]),
('private_booking_date_changed', 'Private Booking Date Changed', 'Hi {{first_name}}, your private booking at The Anchor has been rescheduled from {{old_date}} at {{old_time}} to {{new_date}} at {{new_time}}. Reply to this message with any questions.', '{"first_name", "old_date", "old_time", "new_date", "new_time"}'::text[]),
('private_booking_confirmed', 'Private Booking Confirmed', 'Hi {{first_name}}, your private booking at The Anchor on {{event_date}} has been confirmed. We look forward to hosting your event. Reply to this message with any questions.', '{"first_name", "event_date"}'::text[]),
('private_booking_cancelled', 'Private Booking Cancelled', 'Hi {{first_name}}, your private booking at The Anchor on {{event_date}} has been cancelled. Reply to this message with any questions.', '{"first_name", "event_date"}'::text[]);

-- 8. Create a function to calculate balance amount
CREATE OR REPLACE FUNCTION calculate_private_booking_balance(p_booking_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_total NUMERIC;
  v_deposit_paid NUMERIC;
  v_final_paid NUMERIC;
BEGIN
  -- Get total from booking items
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM private_booking_items
  WHERE booking_id = p_booking_id;
  
  -- Get deposit amount paid
  SELECT COALESCE(deposit_amount, 0) INTO v_deposit_paid
  FROM private_bookings
  WHERE id = p_booking_id
    AND deposit_paid_date IS NOT NULL;
  
  -- Check if final payment made
  SELECT CASE WHEN final_payment_date IS NOT NULL THEN 0 ELSE 1 END INTO v_final_paid
  FROM private_bookings
  WHERE id = p_booking_id;
  
  -- If final payment made, balance is 0
  IF v_final_paid = 0 THEN
    RETURN 0;
  END IF;
  
  -- Otherwise return total minus deposit
  RETURN v_total - v_deposit_paid;
END;
$$ LANGUAGE plpgsql;

-- 9. Create a view for scheduled SMS reminders
CREATE OR REPLACE VIEW private_booking_sms_reminders AS
SELECT 
  pb.id as booking_id,
  pb.customer_first_name,
  pb.contact_phone,
  pb.event_date,
  pb.start_time,
  pb.guest_count,
  pb.balance_due_date,
  pb.deposit_paid_date,
  pb.final_payment_date,
  pb.status,
  -- 14 day reminder
  CASE 
    WHEN pb.event_date - INTERVAL '14 days' > NOW() 
    THEN pb.event_date - INTERVAL '14 days'
    ELSE NULL 
  END as reminder_14d_due,
  -- Balance reminder (10 days before event, 3 days before balance due)
  CASE 
    WHEN pb.balance_due_date IS NOT NULL 
      AND pb.final_payment_date IS NULL
      AND pb.balance_due_date - INTERVAL '3 days' > NOW()
    THEN pb.balance_due_date - INTERVAL '3 days'
    ELSE NULL 
  END as balance_reminder_due,
  -- 1 day reminder
  CASE 
    WHEN pb.event_date - INTERVAL '1 day' > NOW() 
    THEN pb.event_date - INTERVAL '1 day'
    ELSE NULL 
  END as reminder_1d_due,
  calculate_private_booking_balance(pb.id) as balance_amount
FROM private_bookings pb
WHERE pb.status IN ('tentative', 'confirmed')
  AND pb.contact_phone IS NOT NULL
  AND pb.event_date > NOW();

-- 10. Add comment documentation
COMMENT ON COLUMN private_booking_sms_queue.priority IS '1=Highest (payments), 2=High (status changes), 3=Normal (reminders), 4=Low, 5=Lowest';
COMMENT ON COLUMN private_booking_sms_queue.skip_conditions IS 'JSON array of conditions that would skip this SMS, e.g. ["final_payment_received"]';
COMMENT ON COLUMN private_booking_sms_queue.metadata IS 'Additional data for the SMS, including template variables';
COMMENT ON FUNCTION should_send_private_booking_sms IS 'Checks if an SMS should be sent based on daily limits and priority';
COMMENT ON FUNCTION queue_private_booking_sms IS 'Queues an SMS with automatic deduplication and priority handling';

-- Show summary
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== Private Booking SMS System Enhanced ===';
  RAISE NOTICE '✓ Added priority system for SMS deduplication';
  RAISE NOTICE '✓ Created message templates for all scenarios';
  RAISE NOTICE '✓ Added functions for smart SMS queuing';
  RAISE NOTICE '✓ Created view for scheduled reminders';
  RAISE NOTICE '✓ Ready for comprehensive SMS notifications';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Update privateBookingActions.ts to use queue_private_booking_sms()';
  RAISE NOTICE '2. Add SMS triggers to payment functions';
  RAISE NOTICE '3. Set up cron job to process scheduled reminders';
END $$;