-- Migration: Standardize all phone numbers to E.164 format (+44...)
-- This fixes the issue where customers appear as "Unknown" due to phone number format mismatches

BEGIN;

-- First, let's check what formats we have
DO $$
BEGIN
  RAISE NOTICE 'Current phone number formats in database:';
  RAISE NOTICE 'Numbers starting with +44: %', (SELECT COUNT(*) FROM customers WHERE mobile_number LIKE '+44%');
  RAISE NOTICE 'Numbers starting with 07: %', (SELECT COUNT(*) FROM customers WHERE mobile_number LIKE '07%');
  RAISE NOTICE 'Numbers starting with 01: %', (SELECT COUNT(*) FROM customers WHERE mobile_number LIKE '01%');
  RAISE NOTICE 'Other formats: %', (SELECT COUNT(*) FROM customers WHERE mobile_number NOT LIKE '+44%' AND mobile_number NOT LIKE '07%' AND mobile_number NOT LIKE '01%');
END $$;

-- Update UK mobile numbers (07...) to E.164 format (+447...)
UPDATE customers
SET mobile_number = '+44' || SUBSTRING(mobile_number FROM 2)
WHERE mobile_number ~ '^0[0-9]{10}$'  -- Matches UK format with exactly 11 digits starting with 0
  AND mobile_number LIKE '07%';       -- Only mobile numbers

-- Fix malformed numbers that have incorrect digit counts
-- Example: 078889600378 should be 07888960378 (remove extra digit)
UPDATE customers
SET mobile_number = CASE
  -- If it's 12 digits starting with 07, likely has an extra digit
  WHEN mobile_number ~ '^07[0-9]{10}$' THEN 
    '+44' || SUBSTRING(mobile_number FROM 2 FOR 10)
  -- If it's 10 digits starting with 7, likely missing the 0
  WHEN mobile_number ~ '^7[0-9]{9}$' THEN 
    '+447' || mobile_number
  ELSE mobile_number
END
WHERE mobile_number !~ '^\+44[0-9]{10}$'  -- Not already in correct E.164 format
  AND mobile_number !~ '^0[0-9]{10}$';    -- Not in correct UK format

-- Handle numbers that already have country code but no +
UPDATE customers
SET mobile_number = '+' || mobile_number
WHERE mobile_number ~ '^44[0-9]{10}$';

-- Log any remaining non-standard numbers for manual review
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE 'Numbers that could not be automatically standardized:';
  FOR rec IN 
    SELECT id, first_name, last_name, mobile_number 
    FROM customers 
    WHERE mobile_number !~ '^\+44[0-9]{10}$'
    ORDER BY created_at
  LOOP
    RAISE NOTICE 'Customer: % % (ID: %), Number: %', 
      rec.first_name, rec.last_name, rec.id, rec.mobile_number;
  END LOOP;
END $$;

-- Update the messages table to match standardized customer numbers
-- This ensures existing messages are linked to the correct customers
UPDATE messages m
SET customer_phone_number = c.mobile_number
FROM customers c
WHERE (
  -- Match various formats
  m.customer_phone_number = REPLACE(c.mobile_number, '+44', '0') OR
  m.customer_phone_number = REPLACE(c.mobile_number, '+44', '44') OR
  m.customer_phone_number = c.mobile_number OR
  m.customer_phone_number = '+' || c.mobile_number OR
  m.customer_phone_number = '0' || SUBSTRING(c.mobile_number FROM 4) -- +447 -> 07
)
AND m.customer_id = c.id;

-- Final validation
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM customers
  WHERE mobile_number !~ '^\+44[0-9]{10}$';
  
  IF invalid_count > 0 THEN
    RAISE NOTICE 'WARNING: % customers still have non-standard phone numbers', invalid_count;
    RAISE NOTICE 'These may need manual correction';
  ELSE
    RAISE NOTICE 'SUCCESS: All customer phone numbers are now in E.164 format (+44...)';
  END IF;
END $$;

-- Add a comment to document this standardization
COMMENT ON COLUMN customers.mobile_number IS 'Phone number in E.164 format (e.g., +447700900123). Standardized on 2025-06-19.';

COMMIT;