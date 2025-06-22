-- Comprehensive phone number standardization migration
-- This will fix all phone numbers in the database to a consistent format

-- First, let's see what we're dealing with
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE 'Analyzing current phone numbers...';
  
  -- Show sample of different phone formats
  FOR rec IN 
    SELECT DISTINCT 
      CASE 
        WHEN mobile_number ~ '^\+447' THEN '+447...'
        WHEN mobile_number ~ '^447' THEN '447...'
        WHEN mobile_number ~ '^07' THEN '07...'
        WHEN mobile_number ~ '^7' THEN '7...'
        WHEN mobile_number ~ '^\+44' THEN '+44...'
        WHEN mobile_number ~ '^44' THEN '44...'
        WHEN mobile_number ~ '^0' THEN '0...'
        ELSE 'Other format'
      END as format_type,
      COUNT(*) as count
    FROM customers
    WHERE mobile_number IS NOT NULL AND mobile_number != ''
    GROUP BY format_type
  LOOP
    RAISE NOTICE 'Customer phones - Format: %, Count: %', rec.format_type, rec.count;
  END LOOP;
END $$;

-- Create a more flexible standardization function
CREATE OR REPLACE FUNCTION standardize_phone_flexible(phone text)
RETURNS text AS $$
DECLARE
  cleaned text;
BEGIN
  -- Return NULL for NULL or empty input
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;
  
  -- Remove all non-numeric characters except leading +
  cleaned := regexp_replace(phone, '[^0-9+]', '', 'g');
  
  -- Remove any + that's not at the start
  cleaned := regexp_replace(cleaned, '(?<!^)\+', '', 'g');
  
  -- Handle various UK formats
  -- UK mobile starting with 07
  IF cleaned ~ '^07\d{9}$' THEN
    RETURN '+44' || substring(cleaned from 2);
  -- UK number starting with 447
  ELSIF cleaned ~ '^447\d{9}$' THEN
    RETURN '+' || cleaned;
  -- UK number starting with +447
  ELSIF cleaned ~ '^\+447\d{9}$' THEN
    RETURN cleaned;
  -- UK number starting with 00447
  ELSIF cleaned ~ '^00447\d{9}$' THEN
    RETURN '+' || substring(cleaned from 3);
  -- Just 7 followed by 9 digits (assume UK mobile)
  ELSIF cleaned ~ '^7\d{9}$' THEN
    RETURN '+44' || cleaned;
  -- UK landline formats (01, 02, 03, etc)
  ELSIF cleaned ~ '^0[1-3]\d{9,10}$' THEN
    RETURN '+44' || substring(cleaned from 2);
  -- Already in international format
  ELSIF cleaned ~ '^\+44\d{10,11}$' THEN
    RETURN cleaned;
  -- Other international numbers - keep as is if valid
  ELSIF cleaned ~ '^\+[1-9]\d{7,14}$' THEN
    RETURN cleaned;
  -- Special case: Some numbers stored without country code
  ELSIF cleaned ~ '^\d{10}$' AND substring(cleaned for 1) = '7' THEN
    -- Likely UK mobile without 0
    RETURN '+447' || substring(cleaned from 2);
  ELSE
    -- Log problematic numbers
    RAISE NOTICE 'Could not standardize phone number: %', phone;
    -- For now, try to keep it if it looks like a phone number
    IF length(cleaned) >= 7 AND cleaned ~ '^\+?\d+$' THEN
      -- If it doesn't have a country code, assume UK
      IF cleaned !~ '^\+' THEN
        RETURN '+44' || cleaned;
      ELSE
        RETURN cleaned;
      END IF;
    END IF;
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Log what we're about to change
INSERT INTO audit_logs (
  user_id,
  user_email,
  operation_type,
  resource_type,
  resource_id,
  operation_status,
  old_values,
  new_values,
  additional_info,
  ip_address,
  user_agent
)
SELECT 
  NULL,
  'system@migration',
  'update',
  'customer',
  id::text,
  'success',
  jsonb_build_object('mobile_number', mobile_number),
  jsonb_build_object('mobile_number', standardize_phone_flexible(mobile_number)),
  jsonb_build_object(
    'migration', '20250622_comprehensive_phone_fix',
    'original_format', mobile_number,
    'standardized_format', standardize_phone_flexible(mobile_number)
  ),
  '127.0.0.1'::inet,
  'Migration Script'
FROM customers
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND mobile_number != standardize_phone_flexible(mobile_number);

-- Show what will be changed
DO $$
DECLARE
  total_customers INTEGER;
  total_employees INTEGER;
  null_results_customers INTEGER;
  null_results_employees INTEGER;
  rec RECORD;
BEGIN
  SELECT COUNT(*) INTO total_customers
  FROM customers
  WHERE mobile_number IS NOT NULL 
    AND mobile_number != ''
    AND mobile_number != standardize_phone_flexible(mobile_number);
    
  SELECT COUNT(*) INTO null_results_customers
  FROM customers
  WHERE mobile_number IS NOT NULL 
    AND mobile_number != ''
    AND standardize_phone_flexible(mobile_number) IS NULL;
    
  SELECT COUNT(*) INTO total_employees
  FROM employees
  WHERE phone_number IS NOT NULL 
    AND phone_number != ''
    AND phone_number != standardize_phone_flexible(phone_number);
    
  SELECT COUNT(*) INTO null_results_employees
  FROM employees
  WHERE phone_number IS NOT NULL 
    AND phone_number != ''
    AND standardize_phone_flexible(phone_number) IS NULL;
    
  RAISE NOTICE 'Will update % customer phone numbers (%  cannot be standardized)', total_customers, null_results_customers;
  RAISE NOTICE 'Will update % employee phone numbers (% cannot be standardized)', total_employees, null_results_employees;
  
  -- Show examples of problematic numbers
  IF null_results_customers > 0 THEN
    RAISE NOTICE 'Examples of customer numbers that cannot be standardized:';
    FOR rec IN 
      SELECT mobile_number 
      FROM customers 
      WHERE mobile_number IS NOT NULL 
        AND mobile_number != ''
        AND standardize_phone_flexible(mobile_number) IS NULL
      LIMIT 5
    LOOP
      RAISE NOTICE '  - %', rec.mobile_number;
    END LOOP;
  END IF;
END $$;

-- Update customer phone numbers
UPDATE customers
SET mobile_number = standardize_phone_flexible(mobile_number)
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND standardize_phone_flexible(mobile_number) IS NOT NULL;

-- Update employee phone numbers  
UPDATE employees
SET phone_number = standardize_phone_flexible(phone_number)
WHERE phone_number IS NOT NULL 
  AND phone_number != ''
  AND standardize_phone_flexible(phone_number) IS NOT NULL;

-- For numbers that couldn't be standardized, we'll need to handle them specially
-- Let's create a temporary table to store them for manual review
CREATE TABLE IF NOT EXISTS phone_standardization_issues (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  original_phone text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Log problematic customer numbers
INSERT INTO phone_standardization_issues (table_name, record_id, original_phone)
SELECT 'customers', id, mobile_number
FROM customers
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND standardize_phone_flexible(mobile_number) IS NULL;

-- Log problematic employee numbers
INSERT INTO phone_standardization_issues (table_name, record_id, original_phone)
SELECT 'employees', employee_id, phone_number
FROM employees
WHERE phone_number IS NOT NULL 
  AND phone_number != ''
  AND standardize_phone_flexible(phone_number) IS NULL;

-- For now, set problematic numbers to NULL so constraints can be applied
UPDATE customers
SET mobile_number = NULL
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND standardize_phone_flexible(mobile_number) IS NULL;

UPDATE employees
SET phone_number = NULL
WHERE phone_number IS NOT NULL 
  AND phone_number != ''
  AND standardize_phone_flexible(phone_number) IS NULL;

-- Now apply constraints that match the standardized format
-- These will be more flexible than pure E.164
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_phone_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_phone_format 
  CHECK (
    mobile_number IS NULL OR 
    mobile_number ~ '^\+[1-9]\d{7,14}$' OR  -- E.164 format
    mobile_number ~ '^0[1-9]\d{9,10}$'      -- UK national format (for backward compatibility)
  );

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_phone_format;
ALTER TABLE employees ADD CONSTRAINT chk_employee_phone_format 
  CHECK (
    phone_number IS NULL OR 
    phone_number ~ '^\+[1-9]\d{7,14}$' OR   -- E.164 format
    phone_number ~ '^0[1-9]\d{9,10}$'       -- UK national format (for backward compatibility)
  );

-- Add the scheduled_for column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'private_booking_sms_queue' 
    AND column_name = 'scheduled_for'
  ) THEN
    ALTER TABLE private_booking_sms_queue
    ADD COLUMN scheduled_for timestamptz;

    -- Add index for efficient querying
    CREATE INDEX idx_private_booking_sms_queue_scheduled_for 
    ON private_booking_sms_queue(scheduled_for, status)
    WHERE status IN ('pending', 'approved');

    -- Add comment
    COMMENT ON COLUMN private_booking_sms_queue.scheduled_for IS 
    'When this message should be automatically sent. NULL means manual sending only.';
  END IF;
END $$;

-- Show summary
DO $$
DECLARE
  issues_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO issues_count FROM phone_standardization_issues;
  
  IF issues_count > 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '=== IMPORTANT ===';
    RAISE NOTICE '% phone numbers could not be automatically standardized and have been set to NULL.', issues_count;
    RAISE NOTICE 'These are stored in the phone_standardization_issues table for manual review.';
    RAISE NOTICE 'To view them: SELECT * FROM phone_standardization_issues;';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '=== SUCCESS ===';
    RAISE NOTICE 'All phone numbers have been successfully standardized!';
  END IF;
END $$;

-- Clean up the standardization function (we'll keep it for future use)
-- DROP FUNCTION IF EXISTS standardize_phone_flexible(text);