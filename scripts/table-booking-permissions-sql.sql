-- Fix Table Booking API Permissions
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- First, let's check the current permissions for the API key
SELECT 
  name,
  permissions,
  is_active,
  last_used_at,
  usage_count
FROM api_keys
WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5';

-- Update the API key to include table booking permissions
UPDATE api_keys 
SET permissions = jsonb_build_array(
  'read:events',
  'read:menu', 
  'read:business',
  'read:table_bookings',    -- Required for availability check
  'write:table_bookings',   -- Required for creating bookings
  'create:bookings',        -- Alternative permission
  'read:customers',         -- For customer lookup
  'write:customers'         -- For new customers
),
updated_at = NOW()
WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5'
  AND name = 'The Anchor Website';

-- Verify the update
SELECT 
  name,
  permissions,
  updated_at
FROM api_keys
WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5';

-- Expected result: You should see the permissions array now includes 'read:table_bookings'