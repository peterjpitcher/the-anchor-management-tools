-- Description: Remove unnecessary fields from employee tables and drop employment_terms table

-- Remove unnecessary columns from employees table
ALTER TABLE employees 
DROP COLUMN IF EXISTS post_code,
DROP COLUMN IF EXISTS mobile_number,
DROP COLUMN IF EXISTS uniform_preference,
DROP COLUMN IF EXISTS keyholder_status,
DROP COLUMN IF EXISTS first_shift_date;

-- Remove unnecessary columns from employee_emergency_contacts table
ALTER TABLE employee_emergency_contacts
DROP COLUMN IF EXISTS mobile_number;

-- Remove unnecessary columns from employee_employment_terms table
DROP TABLE IF EXISTS employee_employment_terms;

-- Add photo_storage_path to employee_right_to_work table for document photos
ALTER TABLE employee_right_to_work
ADD COLUMN IF NOT EXISTS photo_storage_path TEXT;