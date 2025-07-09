-- Description: Add 'Prospective' status option for employees

-- Drop the existing constraint
ALTER TABLE employees 
DROP CONSTRAINT IF EXISTS employees_status_check;

-- Add the new constraint with 'Prospective' included
ALTER TABLE employees 
ADD CONSTRAINT employees_status_check 
CHECK (status IN ('Active', 'Former', 'Prospective'));

-- Add comment for documentation
COMMENT ON COLUMN employees.status IS 'Employee status: Active (currently employed), Former (no longer employed), or Prospective (potential future employee)';