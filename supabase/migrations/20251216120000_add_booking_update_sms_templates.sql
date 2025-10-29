-- Description: Add SMS templates for booking updates

INSERT INTO public.table_booking_sms_templates (template_key, booking_type, template_text, variables, is_active)
VALUES
  (
    'booking_update_regular',
    'regular',
    'Hi {{customer_name}}, we''ve updated your booking {{reference}} to {{date}} at {{time}} for {{party_size}} guests. Call {{contact_phone}} if you need to make further changes. The Anchor',
    ARRAY['customer_name', 'reference', 'date', 'time', 'party_size', 'contact_phone'],
    true
  ),
  (
    'booking_update_sunday_lunch',
    'sunday_lunch',
    'Hi {{customer_name}}, we''ve updated your Sunday Lunch booking {{reference}} to {{date}} at {{time}} for {{party_size}} guests. Call {{contact_phone}} if you need to make further changes. The Anchor',
    ARRAY['customer_name', 'reference', 'date', 'time', 'party_size', 'contact_phone'],
    true
  )
ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  updated_at = NOW()
WHERE table_booking_sms_templates.is_active = true;

