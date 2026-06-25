ALTER TABLE public.sms_promo_context
  ADD COLUMN IF NOT EXISTS inbound_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inbound_twilio_message_sid text,
  ADD COLUMN IF NOT EXISTS booking_created_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS sms_promo_context_inbound_twilio_sid_unique
  ON public.sms_promo_context (inbound_twilio_message_sid)
  WHERE inbound_twilio_message_sid IS NOT NULL;
