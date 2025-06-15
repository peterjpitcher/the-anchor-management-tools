-- Fix message status columns to use TEXT instead of enum
-- This simplifies the schema and avoids type conflicts

-- First, drop the trigger that depends on the column
DROP TRIGGER IF EXISTS update_customer_sms_status_trigger ON public.messages;

-- Drop the trigger function too
DROP FUNCTION IF EXISTS update_customer_sms_status();

-- Now we can safely drop the column
ALTER TABLE public.messages 
DROP COLUMN IF EXISTS twilio_status;

-- Drop the enum type if it exists
DROP TYPE IF EXISTS message_status_type;

-- Re-add twilio_status as TEXT
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS twilio_status TEXT;

-- Ensure all other columns exist as TEXT
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS twilio_message_sid TEXT,
ADD COLUMN IF NOT EXISTS error_code TEXT,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS price DECIMAL(10, 4),
ADD COLUMN IF NOT EXISTS price_unit TEXT,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP WITH TIME ZONE;

-- Recreate the message_delivery_status table with TEXT status
DROP TABLE IF EXISTS public.message_delivery_status;

CREATE TABLE public.message_delivery_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  raw_webhook_data JSONB
);

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_message_delivery_status_message_id ON public.message_delivery_status(message_id);
CREATE INDEX IF NOT EXISTS idx_message_delivery_status_created_at ON public.message_delivery_status(created_at);

-- Enable RLS
ALTER TABLE public.message_delivery_status ENABLE ROW LEVEL SECURITY;

-- Recreate RLS policies
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

-- Recreate the trigger function without enum type
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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_customer_sms_status_trigger ON public.messages;

-- Recreate trigger
CREATE TRIGGER update_customer_sms_status_trigger
AFTER UPDATE OF twilio_status ON public.messages
FOR EACH ROW
WHEN (NEW.twilio_status IS DISTINCT FROM OLD.twilio_status)
EXECUTE FUNCTION update_customer_sms_status();