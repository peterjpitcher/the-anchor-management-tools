-- Add code and expires_at fields to reward_redemptions table

-- Add code column for unique redemption codes
ALTER TABLE reward_redemptions 
ADD COLUMN IF NOT EXISTS code VARCHAR(10) UNIQUE;

-- Add expires_at column for time-limited redemptions
ALTER TABLE reward_redemptions 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Create index on code for fast lookups
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code 
ON reward_redemptions(code) WHERE code IS NOT NULL;

-- Create index on expires_at for filtering active redemptions
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_expires_at 
ON reward_redemptions(expires_at) WHERE expires_at IS NOT NULL;