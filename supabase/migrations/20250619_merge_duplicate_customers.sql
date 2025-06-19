-- Migration: Merge duplicate "Unknown" customers with existing customers
-- This should be run AFTER the phone number standardization migration

BEGIN;

-- Create a temporary table to track merges for audit purposes
CREATE TEMP TABLE customer_merges (
  unknown_customer_id UUID,
  existing_customer_id UUID,
  phone_number TEXT,
  unknown_created_at TIMESTAMPTZ,
  existing_name TEXT
);

-- Find "Unknown" customers that match existing customers by phone number
INSERT INTO customer_merges
SELECT 
  u.id as unknown_customer_id,
  e.id as existing_customer_id,
  u.mobile_number as phone_number,
  u.created_at as unknown_created_at,
  e.first_name || ' ' || e.last_name as existing_name
FROM customers u
JOIN customers e ON (
  -- Match on standardized phone numbers
  u.mobile_number = e.mobile_number OR
  -- Also try matching with format variations just in case
  u.mobile_number = REPLACE(e.mobile_number, '+44', '0') OR
  e.mobile_number = REPLACE(u.mobile_number, '+44', '0')
)
WHERE u.first_name = 'Unknown'
  AND e.first_name != 'Unknown'
  AND u.id != e.id
  AND u.created_at > e.created_at; -- Unknown was created after the existing customer

-- Log the merges that will happen
DO $$
DECLARE
  rec RECORD;
  merge_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO merge_count FROM customer_merges;
  RAISE NOTICE 'Found % duplicate Unknown customers to merge', merge_count;
  
  IF merge_count > 0 THEN
    RAISE NOTICE 'Merge details:';
    FOR rec IN 
      SELECT * FROM customer_merges 
      ORDER BY unknown_created_at 
      LIMIT 10
    LOOP
      RAISE NOTICE 'Will merge Unknown customer % into existing customer % (%)', 
        rec.unknown_customer_id, rec.existing_customer_id, rec.existing_name;
    END LOOP;
    
    IF merge_count > 10 THEN
      RAISE NOTICE '... and % more', merge_count - 10;
    END IF;
  END IF;
END $$;

-- Update all related records to point to the existing customer
-- This includes messages, bookings, and any other related data

-- Update messages
UPDATE messages m
SET customer_id = cm.existing_customer_id
FROM customer_merges cm
WHERE m.customer_id = cm.unknown_customer_id;

-- Update bookings
UPDATE bookings b
SET customer_id = cm.existing_customer_id
FROM customer_merges cm
WHERE b.customer_id = cm.unknown_customer_id;

-- Log the updates
DO $$
DECLARE
  messages_updated INTEGER;
  bookings_updated INTEGER;
BEGIN
  GET DIAGNOSTICS messages_updated = ROW_COUNT;
  RAISE NOTICE 'Updated % messages to existing customers', messages_updated;
  
  GET DIAGNOSTICS bookings_updated = ROW_COUNT;
  RAISE NOTICE 'Updated % bookings to existing customers', bookings_updated;
END $$;

-- Delete the duplicate "Unknown" customers
DELETE FROM customers
WHERE id IN (SELECT unknown_customer_id FROM customer_merges);

-- Log the deletions
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate Unknown customers', deleted_count;
END $$;

-- Clean up any remaining "Unknown" customers that don't have any associated data
-- These are safe to remove as they have no messages or bookings
DELETE FROM customers
WHERE first_name = 'Unknown'
  AND NOT EXISTS (SELECT 1 FROM messages WHERE customer_id = customers.id)
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE customer_id = customers.id);

-- Log final cleanup
DO $$
DECLARE
  cleanup_count INTEGER;
BEGIN
  GET DIAGNOSTICS cleanup_count = ROW_COUNT;
  IF cleanup_count > 0 THEN
    RAISE NOTICE 'Cleaned up % Unknown customers with no associated data', cleanup_count;
  END IF;
END $$;

-- Create an audit log entry for this migration
INSERT INTO audit_logs (
  user_id,
  user_email,
  operation_type,
  resource_type,
  resource_id,
  operation_status,
  old_values,
  new_values,
  ip_address,
  user_agent,
  additional_info
)
SELECT 
  auth.uid(),
  'migration@system',
  'merge_duplicate_customers',
  'customer',
  existing_customer_id::TEXT,
  'success',
  jsonb_build_object(
    'unknown_customer_id', unknown_customer_id,
    'phone_number', phone_number
  ),
  jsonb_build_object(
    'merged_at', NOW(),
    'merge_count', COUNT(*) OVER()
  ),
  '127.0.0.1'::INET,
  'database_migration',
  jsonb_build_object(
    'migration_name', 'standardize_phone_numbers',
    'total_merges', COUNT(*) OVER()
  )
FROM customer_merges
LIMIT 1; -- Just one summary entry

-- Final summary
DO $$
DECLARE
  remaining_unknown INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_unknown
  FROM customers
  WHERE first_name = 'Unknown';
  
  RAISE NOTICE 'Migration complete. Remaining Unknown customers: %', remaining_unknown;
  RAISE NOTICE 'These may be legitimate new contacts from SMS messages';
END $$;

COMMIT;