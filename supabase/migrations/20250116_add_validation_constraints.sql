-- Add validation constraints to ensure data integrity

-- Email validation for employees
ALTER TABLE employees 
ADD CONSTRAINT chk_employee_email_format 
CHECK (email_address IS NULL OR email_address ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Phone number validation for UK format
-- Accepts: +44xxxxxxxxxx, 44xxxxxxxxxx, 0xxxxxxxxx, or just digits
ALTER TABLE customers 
ADD CONSTRAINT chk_customer_phone_format 
CHECK (mobile_number ~* '^(\+?44|0)?[0-9]{10,11}$');

ALTER TABLE employees 
ADD CONSTRAINT chk_employee_phone_format 
CHECK (phone_number IS NULL OR phone_number ~* '^(\+?44|0)?[0-9]{10,11}$');

ALTER TABLE employee_emergency_contacts 
ADD CONSTRAINT chk_emergency_phone_format 
CHECK (phone_number IS NULL OR phone_number ~* '^(\+?44|0)?[0-9]{10,11}$');

-- Date validations for employees
ALTER TABLE employees 
ADD CONSTRAINT chk_employment_dates 
CHECK (employment_end_date IS NULL OR employment_end_date > employment_start_date);

ALTER TABLE employees 
ADD CONSTRAINT chk_date_of_birth 
CHECK (date_of_birth IS NULL OR (date_of_birth > '1900-01-01' AND date_of_birth < CURRENT_DATE));

-- Status validation for employees
ALTER TABLE employees 
ADD CONSTRAINT chk_employee_status 
CHECK (status IN ('Active', 'Former'));

-- Text length limits
ALTER TABLE employees 
ADD CONSTRAINT chk_employee_name_length 
CHECK (
  LENGTH(first_name) <= 100 AND 
  LENGTH(last_name) <= 100 AND 
  (job_title IS NULL OR LENGTH(job_title) <= 100)
);

ALTER TABLE customers 
ADD CONSTRAINT chk_customer_name_length 
CHECK (
  LENGTH(first_name) <= 100 AND 
  LENGTH(last_name) <= 100
);

-- Email length constraint
ALTER TABLE employees 
ADD CONSTRAINT chk_email_length 
CHECK (email_address IS NULL OR LENGTH(email_address) <= 255);

-- Financial data validation for UK bank accounts
ALTER TABLE employee_financial_details 
ADD CONSTRAINT chk_bank_details 
CHECK (
  (bank_account_number IS NULL OR bank_account_number ~* '^[0-9]{8}$') AND
  (bank_sort_code IS NULL OR bank_sort_code ~* '^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$')
);

-- Event date validation (not too far in the past for new events)
-- This is a softer constraint - events shouldn't be created for dates more than 1 year in the past
ALTER TABLE events 
ADD CONSTRAINT chk_event_date_reasonable 
CHECK (date >= CURRENT_DATE - INTERVAL '1 year');

-- Booking seats validation
ALTER TABLE bookings 
ADD CONSTRAINT chk_booking_seats 
CHECK (seats >= 0);

-- Message direction validation
ALTER TABLE messages 
ADD CONSTRAINT chk_message_direction 
CHECK (direction IN ('inbound', 'outbound'));

-- Add comments explaining constraints
COMMENT ON CONSTRAINT chk_employee_email_format ON employees IS 'Ensures email addresses follow valid format';
COMMENT ON CONSTRAINT chk_customer_phone_format ON customers IS 'Ensures UK phone numbers are in valid format';
COMMENT ON CONSTRAINT chk_employment_dates ON employees IS 'Ensures employment end date is after start date';
COMMENT ON CONSTRAINT chk_date_of_birth ON employees IS 'Ensures date of birth is reasonable (after 1900 and before current date)';
COMMENT ON CONSTRAINT chk_employee_status ON employees IS 'Ensures employee status is either Active or Former';
COMMENT ON CONSTRAINT chk_bank_details ON employee_financial_details IS 'Ensures UK bank account and sort code formats are valid';