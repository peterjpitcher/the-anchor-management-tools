-- Description: Update Sunday lunch SMS templates to reflect deposit system

-- Update Sunday lunch booking confirmation to mention deposit
UPDATE public.table_booking_sms_templates
SET 
  template_text = 'Hi {{customer_name}}, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. £{{deposit_amount}} deposit paid. £{{outstanding_amount}} due on arrival. Reference: {{reference}}. Call {{contact_phone}} for any changes. The Anchor',
  variables = ARRAY['customer_name', 'party_size', 'date', 'time', 'deposit_amount', 'outstanding_amount', 'reference', 'contact_phone'],
  updated_at = NOW()
WHERE template_key = 'booking_confirmation_sunday_lunch';

-- Update Sunday lunch reminder to mention outstanding balance
UPDATE public.table_booking_sms_templates
SET 
  template_text = 'Hi {{customer_name}}, reminder of your Sunday Lunch tomorrow at {{time}} for {{party_size}}. Roasts: {{roast_summary}}. Balance due: £{{outstanding_amount}}. Reference: {{reference}}. The Anchor',
  variables = ARRAY['customer_name', 'time', 'party_size', 'roast_summary', 'outstanding_amount', 'reference'],
  updated_at = NOW()
WHERE template_key = 'reminder_sunday_lunch';

-- Update payment request to reflect deposit amount
UPDATE public.table_booking_sms_templates
SET 
  template_text = 'Hi {{customer_name}}, a £{{deposit_amount}} deposit is required for your Sunday Lunch booking {{reference}}. Total: £{{total_amount}}. Pay by {{deadline}}: {{payment_link}}. The Anchor',
  variables = ARRAY['customer_name', 'deposit_amount', 'total_amount', 'reference', 'deadline', 'payment_link'],
  updated_at = NOW()
WHERE template_key = 'payment_request' AND booking_type = 'sunday_lunch';

-- Add new template for deposit payment confirmation
INSERT INTO public.table_booking_sms_templates (template_key, booking_type, template_text, variables, is_active)
VALUES (
  'deposit_payment_confirmation',
  'sunday_lunch',
  'Hi {{customer_name}}, £{{deposit_amount}} deposit received for your Sunday Lunch on {{date}}. £{{outstanding_amount}} due on arrival. Reference: {{reference}}. The Anchor',
  ARRAY['customer_name', 'deposit_amount', 'outstanding_amount', 'date', 'reference'],
  true
)
ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  booking_type = EXCLUDED.booking_type,
  updated_at = NOW();