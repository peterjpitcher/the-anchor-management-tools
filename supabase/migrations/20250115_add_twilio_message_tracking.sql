-- Add Twilio message tracking and delivery status
-- This migration adds support for bi-directional Twilio integration with automatic customer deactivation

-- First, add messaging status to customers table
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS sms_delivery_failures INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_sms_failure_reason TEXT,
ADD COLUMN IF NOT EXISTS last_successful_sms_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sms_deactivated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sms_deactivation_reason TEXT;

-- Create enum for message status types
CREATE TYPE message_status_type AS ENUM (
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'read',
  'received'
);

-- Update messages table to include more detailed tracking
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS twilio_message_sid TEXT,
ADD COLUMN IF NOT EXISTS twilio_status message_status_type,
ADD COLUMN IF NOT EXISTS error_code TEXT,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS price DECIMAL(10, 4),
ADD COLUMN IF NOT EXISTS price_unit TEXT,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP WITH TIME ZONE;

-- Create message delivery tracking table for detailed history
CREATE TABLE IF NOT EXISTS public.message_delivery_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  status message_status_type NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  raw_webhook_data JSONB
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_twilio_message_sid ON public.messages(twilio_message_sid);
CREATE INDEX IF NOT EXISTS idx_messages_twilio_status ON public.messages(twilio_status);
CREATE INDEX IF NOT EXISTS idx_customers_sms_opt_in ON public.customers(sms_opt_in);
CREATE INDEX IF NOT EXISTS idx_customers_sms_delivery_failures ON public.customers(sms_delivery_failures);
CREATE INDEX IF NOT EXISTS idx_message_delivery_status_message_id ON public.message_delivery_status(message_id);
CREATE INDEX IF NOT EXISTS idx_message_delivery_status_created_at ON public.message_delivery_status(created_at);

-- Create a function to automatically update customer SMS status based on failures
CREATE OR REPLACE FUNCTION update_customer_sms_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if the message is outbound and has failed/undelivered status
  IF NEW.direction = 'outbound' AND NEW.twilio_status IN ('failed', 'undelivered') THEN
    -- Update customer's failure count and last failure reason
    UPDATE public.customers
    SET 
      sms_delivery_failures = sms_delivery_failures + 1,
      last_sms_failure_reason = NEW.error_message,
      -- Auto-deactivate based on failure count and error type
      sms_opt_in = CASE 
        -- Invalid number: immediate deactivation
        WHEN NEW.error_code IN ('21211', '21614', '21217') THEN false
        -- Carrier violations: deactivate after 3 failures
        WHEN NEW.error_code IN ('21610', '21612') AND sms_delivery_failures >= 2 THEN false
        -- Other failures: deactivate after 5 failures
        WHEN sms_delivery_failures >= 4 THEN false
        ELSE sms_opt_in
      END,
      sms_deactivated_at = CASE
        WHEN NEW.error_code IN ('21211', '21614', '21217') THEN NOW()
        WHEN NEW.error_code IN ('21610', '21612') AND sms_delivery_failures >= 2 THEN NOW()
        WHEN sms_delivery_failures >= 4 THEN NOW()
        ELSE sms_deactivated_at
      END,
      sms_deactivation_reason = CASE
        WHEN NEW.error_code IN ('21211', '21614', '21217') THEN 'Invalid phone number'
        WHEN NEW.error_code IN ('21610', '21612') AND sms_delivery_failures >= 2 THEN 'Carrier violations'
        WHEN sms_delivery_failures >= 4 THEN 'Too many delivery failures'
        ELSE sms_deactivation_reason
      END
    WHERE id = NEW.customer_id;
  -- Reset failure count on successful delivery
  ELSIF NEW.direction = 'outbound' AND NEW.twilio_status = 'delivered' THEN
    UPDATE public.customers
    SET 
      sms_delivery_failures = 0,
      last_successful_sms_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update customer SMS status
CREATE TRIGGER update_customer_sms_status_trigger
AFTER UPDATE OF twilio_status ON public.messages
FOR EACH ROW
WHEN (NEW.twilio_status IS DISTINCT FROM OLD.twilio_status)
EXECUTE FUNCTION update_customer_sms_status();

-- Add RLS policies for new table
ALTER TABLE public.message_delivery_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read message delivery status" 
ON public.message_delivery_status 
FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Allow authenticated users to insert message delivery status" 
ON public.message_delivery_status 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Grant permissions
GRANT ALL ON TABLE public.message_delivery_status TO anon;
GRANT ALL ON TABLE public.message_delivery_status TO authenticated;
GRANT ALL ON TABLE public.message_delivery_status TO service_role;

-- Add comments for documentation
COMMENT ON COLUMN public.customers.sms_opt_in IS 'Whether the customer has opted in to receive SMS messages';
COMMENT ON COLUMN public.customers.sms_delivery_failures IS 'Count of consecutive SMS delivery failures';
COMMENT ON COLUMN public.customers.last_sms_failure_reason IS 'The reason for the last SMS delivery failure';
COMMENT ON COLUMN public.customers.last_successful_sms_at IS 'Timestamp of the last successful SMS delivery';
COMMENT ON COLUMN public.customers.sms_deactivated_at IS 'When SMS was automatically deactivated for this customer';
COMMENT ON COLUMN public.customers.sms_deactivation_reason IS 'Reason for automatic SMS deactivation';
COMMENT ON COLUMN public.messages.twilio_message_sid IS 'Twilio message SID for tracking';
COMMENT ON COLUMN public.messages.twilio_status IS 'Current status of the message from Twilio';
COMMENT ON COLUMN public.messages.error_code IS 'Twilio error code if message failed';
COMMENT ON COLUMN public.messages.error_message IS 'Human-readable error message if failed';
COMMENT ON TABLE public.message_delivery_status IS 'Tracks the full history of message delivery status changes from Twilio webhooks';