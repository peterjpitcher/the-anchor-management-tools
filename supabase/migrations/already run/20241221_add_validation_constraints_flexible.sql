-- Add validation constraints for phone numbers and dates (flexible version)
-- This version allows past events for historical records but prevents past bookings

-- Phone number format constraint (E.164 format)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_phone_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_phone_format 
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9]\d{1,14}$');

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_phone_format;
ALTER TABLE employees ADD CONSTRAINT chk_employee_phone_format 
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9]\d{1,14}$');

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_emergency_phone_format;
ALTER TABLE employees ADD CONSTRAINT chk_emergency_phone_format 
  CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^\+[1-9]\d{1,14}$');

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

-- Email format constraint
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

-- Add indexes for phone number lookups
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_employees_mobile_number ON employees(mobile_number);

-- Fix any existing invalid phone numbers
-- First, log which customers have invalid numbers
DO $$
BEGIN
  -- Log invalid customer phone numbers
  INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    ip_address
  )
  SELECT 
    '00000000-0000-0000-0000-000000000000'::uuid,
    'fix_invalid_phone',
    'customer',
    id,
    jsonb_build_object(
      'old_number', mobile_number,
      'reason', 'Invalid format - migration cleanup'
    ),
    '127.0.0.1'::inet
  FROM customers
  WHERE mobile_number IS NOT NULL 
    AND mobile_number !~ '^\+[1-9]\d{1,14}$';

  -- Update invalid phone numbers to NULL
  UPDATE customers
  SET mobile_number = NULL
  WHERE mobile_number IS NOT NULL 
    AND mobile_number !~ '^\+[1-9]\d{1,14}$';

  -- Same for employees
  UPDATE employees
  SET mobile_number = NULL
  WHERE mobile_number IS NOT NULL 
    AND mobile_number !~ '^\+[1-9]\d{1,14}$';

  UPDATE employees
  SET emergency_contact_phone = NULL
  WHERE emergency_contact_phone IS NOT NULL 
    AND emergency_contact_phone !~ '^\+[1-9]\d{1,14}$';

  -- Fix invalid emails
  UPDATE customers
  SET email_address = NULL
  WHERE email_address IS NOT NULL 
    AND email_address !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';

  UPDATE employees
  SET email_address = NULL
  WHERE email_address IS NOT NULL 
    AND email_address !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END $$;

-- Comment on constraints for documentation
COMMENT ON CONSTRAINT chk_customer_phone_format ON customers IS 'Ensures phone numbers are in E.164 format (+447700900123)';
COMMENT ON CONSTRAINT chk_customer_email_format ON customers IS 'Validates email address format';
COMMENT ON CONSTRAINT chk_customer_name_format ON customers IS 'Ensures names contain only letters, spaces, hyphens, and apostrophes';
COMMENT ON CONSTRAINT chk_customer_dob_past ON customers IS 'Ensures date of birth is in the past and after 1900';

-- Add function comments
COMMENT ON FUNCTION check_booking_date() IS 'Prevents creation of bookings for past events';
COMMENT ON FUNCTION check_private_booking_date() IS 'Prevents creation of private bookings for past dates';
COMMENT ON FUNCTION check_booking_capacity() IS 'Ensures bookings do not exceed event capacity';