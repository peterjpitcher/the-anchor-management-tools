-- Update the API key permissions to match what the API expects
UPDATE api_keys 
SET 
  permissions = '["read:events", "read:menu", "read:business", "create:bookings"]'::jsonb,
  description = 'API key for The Anchor website',
  name = 'The Anchor Website API Key'
WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5';

-- Verify the update
SELECT * FROM api_keys WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5';