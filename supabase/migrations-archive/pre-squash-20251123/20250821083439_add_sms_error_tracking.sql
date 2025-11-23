-- Add SMS error tracking fields and improve status handling
-- Description: Adds error_code, error_message fields to messages table and creates indexes for stuck message queries

-- Add error tracking columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'error_code'
  ) THEN
    ALTER TABLE messages ADD COLUMN error_code TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE messages ADD COLUMN error_message TEXT;
  END IF;
  
  -- Add sent_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'sent_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN sent_at TIMESTAMPTZ;
  END IF;
  
  -- Add delivered_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'delivered_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN delivered_at TIMESTAMPTZ;
  END IF;
  
  -- Add failed_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'failed_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN failed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create unique index on twilio_message_sid for fast lookups and uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS messages_twilio_sid_unique_idx 
ON messages (twilio_message_sid) 
WHERE twilio_message_sid IS NOT NULL;

-- Create partial index for stuck messages (queued/sent status)
-- This speeds up reconciliation queries
CREATE INDEX IF NOT EXISTS messages_stuck_idx 
ON messages (status, created_at) 
WHERE status IN ('queued', 'sent') AND direction IN ('outbound', 'outbound-api');

-- Create index for webhook status updates
CREATE INDEX IF NOT EXISTS messages_twilio_sid_idx 
ON messages (twilio_message_sid) 
WHERE twilio_message_sid IS NOT NULL;

-- Add note column to message_delivery_status for tracking regression prevention
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'message_delivery_status' AND column_name = 'note'
  ) THEN
    ALTER TABLE message_delivery_status ADD COLUMN note TEXT;
  END IF;
END $$;

-- Create index on message_delivery_status for history queries
CREATE INDEX IF NOT EXISTS message_delivery_status_message_created_idx 
ON message_delivery_status (message_id, created_at DESC);

-- Add direction value for API-sent messages (if not exists)
-- This helps distinguish between different outbound message types
DO $$
BEGIN
  -- Check if 'outbound-api' is already in the enum
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_enum 
    WHERE enumlabel = 'outbound-api' 
    AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'message_direction'
    )
  ) THEN
    -- Note: Adding enum values requires careful handling
    -- If this fails, it means the enum type doesn't exist or has different structure
    -- In that case, we'll just use the existing values
    BEGIN
      ALTER TYPE message_direction ADD VALUE IF NOT EXISTS 'outbound-api';
    EXCEPTION WHEN OTHERS THEN
      -- Enum might not exist or might be defined differently
      NULL;
    END;
  END IF;
END $$;

-- Create a function to clean old webhook logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM webhook_logs 
  WHERE processed_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to clean webhook logs (if pg_cron is available)
-- Note: This requires pg_cron extension which may not be available
-- Uncomment if pg_cron is installed:
-- SELECT cron.schedule('cleanup-webhook-logs', '0 2 * * *', 'SELECT cleanup_old_webhook_logs();');

-- Add comment documentation
COMMENT ON COLUMN messages.error_code IS 'Twilio error code if message failed';
COMMENT ON COLUMN messages.error_message IS 'Human-readable error message';
COMMENT ON COLUMN messages.sent_at IS 'Timestamp when message was sent by Twilio';
COMMENT ON COLUMN messages.delivered_at IS 'Timestamp when message was delivered to recipient';
COMMENT ON COLUMN messages.failed_at IS 'Timestamp when message delivery failed';
COMMENT ON INDEX messages_stuck_idx IS 'Speeds up queries for stuck messages needing reconciliation';
COMMENT ON INDEX messages_twilio_sid_unique_idx IS 'Ensures unique Twilio SIDs and speeds up webhook lookups';