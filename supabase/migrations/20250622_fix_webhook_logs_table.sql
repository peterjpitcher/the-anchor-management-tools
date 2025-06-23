-- Add missing columns to webhook_logs table to match the application code
ALTER TABLE public.webhook_logs 
ADD COLUMN IF NOT EXISTS headers jsonb,
ADD COLUMN IF NOT EXISTS body text,
ADD COLUMN IF NOT EXISTS params jsonb,
ADD COLUMN IF NOT EXISTS error_details jsonb,
ADD COLUMN IF NOT EXISTS from_number text,
ADD COLUMN IF NOT EXISTS to_number text,
ADD COLUMN IF NOT EXISTS message_body text,
ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id),
ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.messages(id);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_webhook_logs_from_number ON public.webhook_logs(from_number);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_to_number ON public.webhook_logs(to_number);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_customer_id ON public.webhook_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_message_id ON public.webhook_logs(message_id);

-- Add comment explaining the table structure
COMMENT ON TABLE public.webhook_logs IS 'Stores all webhook requests from Twilio for debugging and auditing purposes';
COMMENT ON COLUMN public.webhook_logs.headers IS 'HTTP headers from the webhook request';
COMMENT ON COLUMN public.webhook_logs.body IS 'Raw body of the webhook request (limited to 10000 chars)';
COMMENT ON COLUMN public.webhook_logs.params IS 'Parsed parameters from the webhook body';
COMMENT ON COLUMN public.webhook_logs.error_details IS 'Detailed error information including stack traces';
COMMENT ON COLUMN public.webhook_logs.from_number IS 'Phone number that sent the message (for inbound SMS)';
COMMENT ON COLUMN public.webhook_logs.to_number IS 'Phone number that received the message';
COMMENT ON COLUMN public.webhook_logs.message_body IS 'SMS message content (limited to 1000 chars)';
COMMENT ON COLUMN public.webhook_logs.customer_id IS 'Reference to the customer associated with this webhook';
COMMENT ON COLUMN public.webhook_logs.message_id IS 'Reference to the message created from this webhook';