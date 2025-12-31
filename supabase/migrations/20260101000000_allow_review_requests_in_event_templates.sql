
-- Migration to add 'review_request' to event_message_templates type check constraint

BEGIN;

-- Drop the existing constraint
ALTER TABLE "public"."event_message_templates" 
DROP CONSTRAINT "event_message_templates_template_type_check";

-- Re-add the constraint with 'review_request' included
ALTER TABLE "public"."event_message_templates"
ADD CONSTRAINT "event_message_templates_template_type_check" 
CHECK (("template_type" = ANY (ARRAY[
  'booking_confirmation'::"text", 
  'reminder_7_day'::"text", 
  'reminder_24_hour'::"text", 
  'booking_reminder_confirmation'::"text", 
  'booking_reminder_7_day'::"text", 
  'booking_reminder_24_hour'::"text", 
  'custom'::"text",
  'review_request'::"text"  -- Added this type
])));

COMMIT;
