-- Add validation constraints for phone numbers and dates

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

-- Event date constraint (no past events)
ALTER TABLE events DROP CONSTRAINT IF EXISTS chk_event_date_future;
ALTER TABLE events ADD CONSTRAINT chk_event_date_future 
  CHECK (date >= CURRENT_DATE);

-- Private bookings date constraint
ALTER TABLE private_bookings DROP CONSTRAINT IF EXISTS chk_private_booking_date_future;
ALTER TABLE private_bookings ADD CONSTRAINT chk_private_booking_date_future 
  CHECK (event_date >= CURRENT_DATE);

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

-- Date of birth constraint (must be in past)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_dob_past;
ALTER TABLE customers ADD CONSTRAINT chk_customer_dob_past 
  CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE);

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_dob_past;
ALTER TABLE employees ADD CONSTRAINT chk_employee_dob_past 
  CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE);

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
END $$;

-- Comment on constraints for documentation
COMMENT ON CONSTRAINT chk_customer_phone_format ON customers IS 'Ensures phone numbers are in E.164 format (+447700900123)';
COMMENT ON CONSTRAINT chk_event_date_future ON events IS 'Prevents creation of events in the past';
COMMENT ON CONSTRAINT chk_customer_email_format ON customers IS 'Validates email address format';
COMMENT ON CONSTRAINT chk_customer_name_format ON customers IS 'Ensures names contain only letters, spaces, hyphens, and apostrophes';