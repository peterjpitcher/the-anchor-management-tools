-- Add read_at field to track when messages are read
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;

-- Create index for finding unread inbound messages
CREATE INDEX IF NOT EXISTS idx_messages_unread_inbound 
ON public.messages(customer_id, direction, read_at) 
WHERE direction = 'inbound' AND read_at IS NULL;

-- Update existing outbound messages to be marked as read
UPDATE public.messages 
SET read_at = created_at 
WHERE direction = 'outbound' AND read_at IS NULL;