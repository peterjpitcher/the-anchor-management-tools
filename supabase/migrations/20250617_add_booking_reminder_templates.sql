-- Add separate template types for booking reminders (0 seats)

-- First, update the check constraints to include new template types
ALTER TABLE message_templates 
DROP CONSTRAINT message_templates_template_type_check;

ALTER TABLE message_templates 
ADD CONSTRAINT message_templates_template_type_check 
CHECK (template_type IN ('booking_confirmation', 'reminder_7_day', 'reminder_24_hour', 'booking_reminder_confirmation', 'booking_reminder_7_day', 'booking_reminder_24_hour', 'custom'));

ALTER TABLE event_message_templates 
DROP CONSTRAINT event_message_templates_template_type_check;

ALTER TABLE event_message_templates 
ADD CONSTRAINT event_message_templates_template_type_check 
CHECK (template_type IN ('booking_confirmation', 'reminder_7_day', 'reminder_24_hour', 'booking_reminder_confirmation', 'booking_reminder_7_day', 'booking_reminder_24_hour', 'custom'));

-- Insert default templates for booking reminders (0 seats)
INSERT INTO message_templates (name, template_type, content, variables, is_default, is_active) VALUES
(
  'Default Booking Reminder Confirmation',
  'booking_reminder_confirmation',
  'Hi {{customer_name}}, this is a reminder about {{event_name}} on {{event_date}} at {{event_time}}. No seats have been reserved for this reminder. If you would like to book seats, please contact us. The Anchor Team',
  ARRAY['customer_name', 'event_name', 'event_date', 'event_time'],
  true,
  true
),
(
  'Default 7-Day Booking Reminder',
  'booking_reminder_7_day',
  'Hi {{customer_name}}, reminder: {{event_name}} is happening on {{event_date}} at {{event_time}}. You currently have no seats booked. Contact us if you''d like to reserve seats. The Anchor Team',
  ARRAY['customer_name', 'event_name', 'event_date', 'event_time'],
  true,
  true
),
(
  'Default 24-Hour Booking Reminder',
  'booking_reminder_24_hour',
  'Hi {{customer_name}}, {{event_name}} is tomorrow at {{event_time}}. This is just a reminder - no seats are currently reserved for you. The Anchor Team',
  ARRAY['customer_name', 'event_name', 'event_time'],
  true,
  true
);

-- Update the get_message_template function to handle the new template types
-- (The existing function will work as-is since it's based on template_type parameter)

-- Add comment explaining the distinction
COMMENT ON COLUMN message_templates.template_type IS 'Template type: booking_confirmation/reminder_* for actual bookings with seats, booking_reminder_* for 0-seat reminders';