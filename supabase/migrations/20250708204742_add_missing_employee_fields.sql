-- Description: Add missing fields to employees table (post_code, mobile_number, uniform_preference, keyholder_status, first_shift_date)

-- Add new columns to employees table
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS post_code TEXT,
ADD COLUMN IF NOT EXISTS mobile_number TEXT,
ADD COLUMN IF NOT EXISTS uniform_preference TEXT,
ADD COLUMN IF NOT EXISTS keyholder_status BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS first_shift_date DATE;

-- Add validation for UK mobile numbers (similar to existing phone_number validation)
ALTER TABLE employees
ADD CONSTRAINT employees_mobile_number_check 
CHECK (mobile_number IS NULL OR mobile_number ~ '^(\+44|0)?7\d{9}$');

-- Add comments for documentation
COMMENT ON COLUMN employees.post_code IS 'UK post code (separate from address field)';
COMMENT ON COLUMN employees.mobile_number IS 'Mobile phone number (separate from main phone number)';
COMMENT ON COLUMN employees.uniform_preference IS 'Employee uniform or branded t-shirt preference';
COMMENT ON COLUMN employees.keyholder_status IS 'Whether employee has been granted keyholder status';
COMMENT ON COLUMN employees.first_shift_date IS 'Date of employee''s first scheduled shift';