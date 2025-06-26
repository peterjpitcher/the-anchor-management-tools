-- Fix phone validation and SMS queue issues
-- This migration:
-- 1. Standardizes existing phone numbers to E.164 format
-- 2. Applies phone validation constraints
-- 3. Handles the scheduled_for column properly

-- First, create a function to standardize UK phone numbers to E.164 format
CREATE OR REPLACE FUNCTION standardize_uk_phone(phone text) 
RETURNS text AS $$
DECLARE
  digits text;
BEGIN
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;
  
  -- Remove all non-digits
  digits := regexp_replace(phone, '[^0-9]', '', 'g');
  
  -- UK mobile starting with 07
  IF digits ~ '^07\d{9}$' THEN
    RETURN '+44' || substring(digits from 2);
  END IF;
  
  -- UK number without country code (10 digits starting with 7)
  IF digits ~ '^7\d{9}$' THEN
    RETURN '+44' || digits;
  END IF;
  
  -- Already has UK country code
  IF digits ~ '^447\d{9}$' THEN
    RETURN '+' || digits;
  END IF;
  
  -- With 0044 prefix
  IF digits ~ '^00447\d{9}$' THEN
    RETURN '+' || substring(digits from 3);
  END IF;
  
  -- Already in correct format
  IF phone ~ '^\+447\d{9}$' THEN
    RETURN phone;
  END IF;
  
  -- If we can't standardize it, return NULL (will be handled by constraint)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Log phone numbers that will be changed
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
  jsonb_build_object('mobile_number', standardize_uk_phone(mobile_number)),
  jsonb_build_object('migration', '20250622_fix_phone_validation'),
  '127.0.0.1'::inet,
  'Migration Script'
FROM customers
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND mobile_number != standardize_uk_phone(mobile_number);

-- First, let's see what phone numbers we have that can't be standardized
DO $$
DECLARE
  invalid_customer_count INTEGER;
  invalid_employee_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_customer_count
  FROM customers
  WHERE mobile_number IS NOT NULL 
    AND mobile_number != ''
    AND standardize_uk_phone(mobile_number) IS NULL;
    
  SELECT COUNT(*) INTO invalid_employee_count
  FROM employees
  WHERE phone_number IS NOT NULL 
    AND phone_number != ''
    AND standardize_uk_phone(phone_number) IS NULL;
    
  IF invalid_customer_count > 0 THEN
    RAISE NOTICE 'Found % customer phone numbers that cannot be standardized', invalid_customer_count;
  END IF;
  
  IF invalid_employee_count > 0 THEN
    RAISE NOTICE 'Found % employee phone numbers that cannot be standardized', invalid_employee_count;
  END IF;
END $$;

-- Standardize customer phone numbers
-- For numbers that can be standardized, update them
UPDATE customers
SET mobile_number = standardize_uk_phone(mobile_number)
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND standardize_uk_phone(mobile_number) IS NOT NULL;

-- For numbers that can't be standardized, set them to NULL with audit log
UPDATE customers
SET mobile_number = NULL
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND standardize_uk_phone(mobile_number) IS NULL;

-- Standardize employee phone numbers
UPDATE employees
SET phone_number = standardize_uk_phone(phone_number)
WHERE phone_number IS NOT NULL 
  AND phone_number != ''
  AND standardize_uk_phone(phone_number) IS NOT NULL;

-- For numbers that can't be standardized, set them to NULL
UPDATE employees
SET phone_number = NULL
WHERE phone_number IS NOT NULL 
  AND phone_number != ''
  AND standardize_uk_phone(phone_number) IS NULL;

-- Now apply the phone constraints (these will succeed now that data is standardized)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_phone_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_phone_format 
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9]\d{1,14}$');

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_phone_format;
ALTER TABLE employees ADD CONSTRAINT chk_employee_phone_format 
  CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9]\d{1,14}$');

-- Handle the scheduled_for column issue
-- Check if the column already exists before trying to add it
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
    
    -- Add index for efficient querying of scheduled messages
    CREATE INDEX idx_private_booking_sms_queue_scheduled_for 
    ON private_booking_sms_queue(scheduled_for, status)
    WHERE status IN ('pending', 'approved');
    
    -- Add comment explaining the field
    COMMENT ON COLUMN private_booking_sms_queue.scheduled_for IS 'When this message should be automatically sent. NULL means manual sending only.';
    
    -- Update existing messages to have scheduled_for based on booking dates
    -- This sets reminder messages to be sent 24 hours before the event
    UPDATE private_booking_sms_queue sms
    SET scheduled_for = (
        SELECT (pb.event_date || ' ' || pb.start_time)::timestamptz - INTERVAL '24 hours'
        FROM private_bookings pb
        WHERE pb.id = sms.booking_id
    )
    WHERE sms.trigger_type = 'reminder'
    AND sms.status IN ('pending', 'approved')
    AND sms.scheduled_for IS NULL;
    
    -- For confirmation messages, schedule them to be sent immediately
    UPDATE private_booking_sms_queue
    SET scheduled_for = created_at
    WHERE trigger_type IN ('status_change', 'manual')
    AND status IN ('pending', 'approved')
    AND scheduled_for IS NULL;
  END IF;
END $$;

-- Add indexes for phone number lookups if they don't exist
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_employees_mobile_number ON employees(mobile_number);

-- Email format constraints (from the original migrations)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_email_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_email_format 
  CHECK (email_address IS NULL OR email_address ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_email_format;
ALTER TABLE employees ADD CONSTRAINT chk_employee_email_format 
  CHECK (email_address IS NULL OR email_address ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Name constraints (letters, spaces, hyphens, apostrophes only)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_name_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_name_format 
  CHECK (
    first_name ~ '^[a-zA-Z\s\-'']+$' 
    AND (last_name IS NULL OR last_name ~ '^[a-zA-Z\s\-'']+$')
  );

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_name_format;
ALTER TABLE employees ADD CONSTRAINT chk_employee_name_format 
  CHECK (
    first_name ~ '^[a-zA-Z\s\-'']+$' 
    AND (last_name IS NULL OR last_name ~ '^[a-zA-Z\s\-'']+$')
  );

-- Date of birth constraint (must be in past and reasonable)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_dob_past;
ALTER TABLE customers ADD CONSTRAINT chk_customer_dob_past 
  CHECK (
    date_of_birth IS NULL 
    OR (date_of_birth < CURRENT_DATE AND date_of_birth > '1900-01-01'::date)
  );

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_dob_past;
ALTER TABLE employees ADD CONSTRAINT chk_employee_dob_past 
  CHECK (
    date_of_birth IS NULL 
    OR (date_of_birth < CURRENT_DATE AND date_of_birth > '1900-01-01'::date)
  );

-- Booking date constraint - prevent booking past events
CREATE OR REPLACE FUNCTION check_booking_date()
RETURNS TRIGGER AS $$
DECLARE
  v_event_date DATE;
BEGIN
  -- Get event date
  SELECT date INTO v_event_date
  FROM events
  WHERE id = NEW.event_id;

  -- Allow bookings for current and future events only
  IF v_event_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot create bookings for past events';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for booking date check
DROP TRIGGER IF EXISTS check_booking_date_trigger ON bookings;
CREATE TRIGGER check_booking_date_trigger
  BEFORE INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_booking_date();

-- Private bookings date constraint (no past bookings on creation)
CREATE OR REPLACE FUNCTION check_private_booking_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Only check on INSERT, not UPDATE (to allow editing historical bookings)
  IF TG_OP = 'INSERT' AND NEW.event_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot create private bookings for past dates';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for private booking date check
DROP TRIGGER IF EXISTS check_private_booking_date_trigger ON private_bookings;
CREATE TRIGGER check_private_booking_date_trigger
  BEFORE INSERT ON private_bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_private_booking_date();

-- Booking capacity constraint function
CREATE OR REPLACE FUNCTION check_booking_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_event_capacity INTEGER;
  v_current_bookings INTEGER;
  v_available_seats INTEGER;
BEGIN
  -- Get event capacity
  SELECT capacity INTO v_event_capacity
  FROM events
  WHERE id = NEW.event_id;

  -- Calculate current bookings (excluding the current one if updating)
  SELECT COALESCE(SUM(seats), 0) INTO v_current_bookings
  FROM bookings
  WHERE event_id = NEW.event_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

  -- Check if enough seats available
  v_available_seats := v_event_capacity - v_current_bookings;
  
  IF NEW.seats > v_available_seats THEN
    RAISE EXCEPTION 'Only % seats available for this event', v_available_seats;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for booking capacity check
DROP TRIGGER IF EXISTS check_booking_capacity_trigger ON bookings;
CREATE TRIGGER check_booking_capacity_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_booking_capacity();

-- Comment on constraints for documentation
COMMENT ON CONSTRAINT chk_customer_phone_format ON customers IS 'Ensures phone numbers are in E.164 format (+447700900123)';
COMMENT ON CONSTRAINT chk_customer_email_format ON customers IS 'Validates email address format';
COMMENT ON CONSTRAINT chk_customer_name_format ON customers IS 'Ensures names contain only letters, spaces, hyphens, and apostrophes';
COMMENT ON CONSTRAINT chk_customer_dob_past ON customers IS 'Ensures date of birth is in the past and after 1900';

-- Add function comments
COMMENT ON FUNCTION check_booking_date() IS 'Prevents creation of bookings for past events';
COMMENT ON FUNCTION check_private_booking_date() IS 'Prevents creation of private bookings for past dates';
COMMENT ON FUNCTION check_booking_capacity() IS 'Ensures bookings do not exceed event capacity';
COMMENT ON FUNCTION standardize_uk_phone(text) IS 'Converts UK phone numbers to E.164 format';

-- Clean up the standardization function as it's no longer needed
-- DROP FUNCTION IF EXISTS standardize_uk_phone(text);