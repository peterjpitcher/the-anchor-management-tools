DROP INDEX IF EXISTS public.sms_promo_context_inbound_twilio_sid_unique;

ALTER TABLE public.sms_promo_context
  DROP COLUMN IF EXISTS booking_created_at,
  DROP COLUMN IF EXISTS inbound_twilio_message_sid,
  DROP COLUMN IF EXISTS inbound_message_id;
