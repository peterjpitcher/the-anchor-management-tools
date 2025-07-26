-- Description: Add default SMS templates for table bookings

-- Insert default SMS templates if they don't exist
INSERT INTO public.table_booking_sms_templates (template_key, booking_type, template_text, variables, is_active)
VALUES 
  -- Regular booking confirmation
  (
    'booking_confirmation_regular',
    'regular',
    'Hi {{customer_name}}, your table for {{party_size}} on {{date}} at {{time}} is confirmed. Reference: {{reference}}. If you need to make changes, call {{contact_phone}}. The Anchor',
    ARRAY['customer_name', 'party_size', 'date', 'time', 'reference', 'contact_phone'],
    true
  ),
  -- Sunday lunch booking confirmation
  (
    'booking_confirmation_sunday_lunch',
    'sunday_lunch',
    'Hi {{customer_name}}, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Your roast selections have been noted. Call {{contact_phone}} for any changes. The Anchor',
    ARRAY['customer_name', 'party_size', 'date', 'time', 'reference', 'contact_phone'],
    true
  ),
  -- Regular booking reminder
  (
    'reminder_regular',
    'regular',
    'Hi {{customer_name}}, reminder of your table booking tomorrow at {{time}} for {{party_size}} people. Reference: {{reference}}. See you soon! The Anchor',
    ARRAY['customer_name', 'time', 'party_size', 'reference'],
    true
  ),
  -- Sunday lunch reminder
  (
    'reminder_sunday_lunch',
    'sunday_lunch',
    'Hi {{customer_name}}, reminder of your Sunday Lunch tomorrow at {{time}} for {{party_size}}. Roasts: {{roast_summary}}. Allergies noted: {{allergies}}. Reference: {{reference}}. The Anchor',
    ARRAY['customer_name', 'time', 'party_size', 'roast_summary', 'allergies', 'reference'],
    true
  ),
  -- Cancellation notification
  (
    'cancellation',
    NULL,
    'Your booking {{reference}} has been cancelled. {{refund_message}} For questions, call {{contact_phone}}. The Anchor',
    ARRAY['reference', 'refund_message', 'contact_phone'],
    true
  ),
  -- Payment request for Sunday lunch
  (
    'payment_request',
    'sunday_lunch',
    'Hi {{customer_name}}, payment of £{{amount}} is required for your Sunday Lunch booking {{reference}}. Pay by {{deadline}}: {{payment_link}}. The Anchor',
    ARRAY['customer_name', 'amount', 'reference', 'deadline', 'payment_link'],
    true
  ),
  -- Review request after visit
  (
    'review_request',
    NULL,
    'Hi {{customer_name}}, thanks for dining with us! We''d love your feedback: {{review_link}}. The Anchor',
    ARRAY['customer_name', 'review_link'],
    true
  )
ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  updated_at = NOW()
WHERE table_booking_sms_templates.is_active = true;