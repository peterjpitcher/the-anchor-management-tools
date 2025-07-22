-- Add access token to loyalty_members for direct portal access
-- This allows members to access their loyalty portal without phone verification

-- Add access_token column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' AND column_name = 'access_token'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN access_token VARCHAR(255) UNIQUE;
  END IF;
END $$;

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_loyalty_members_access_token ON loyalty_members(access_token);

-- Function to generate a secure access token
CREATE OR REPLACE FUNCTION generate_loyalty_access_token()
RETURNS VARCHAR AS $$
DECLARE
  token VARCHAR;
BEGIN
  -- Generate a URL-safe random token (32 characters)
  SELECT encode(gen_random_bytes(24), 'base64') INTO token;
  -- Replace URL-unsafe characters
  token := replace(replace(replace(token, '+', '-'), '/', '_'), '=', '');
  RETURN token;
END;
$$ LANGUAGE plpgsql;

-- Update existing members with access tokens
UPDATE loyalty_members 
SET access_token = generate_loyalty_access_token()
WHERE access_token IS NULL;

-- Ensure new members get access tokens automatically
CREATE OR REPLACE FUNCTION set_loyalty_access_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := generate_loyalty_access_token();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new members
DROP TRIGGER IF EXISTS set_loyalty_access_token_trigger ON loyalty_members;
CREATE TRIGGER set_loyalty_access_token_trigger
  BEFORE INSERT ON loyalty_members
  FOR EACH ROW
  EXECUTE FUNCTION set_loyalty_access_token();