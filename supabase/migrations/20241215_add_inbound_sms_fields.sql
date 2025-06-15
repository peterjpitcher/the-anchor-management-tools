-- Add fields to support inbound SMS messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS from_number TEXT,
ADD COLUMN IF NOT EXISTS to_number TEXT,
ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'sms' CHECK (message_type IN ('sms', 'mms', 'whatsapp'));

-- Add index for phone number lookups
CREATE INDEX IF NOT EXISTS idx_messages_from_number ON public.messages(from_number);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON public.messages(direction);

-- Update existing messages to set message_type
UPDATE public.messages 
SET message_type = 'sms' 
WHERE message_type IS NULL;