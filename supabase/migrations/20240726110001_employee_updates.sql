-- Add ni_number to employees table
ALTER TABLE employees
ADD COLUMN ni_number TEXT;

-- Create employee_emergency_contacts table
CREATE TABLE employee_emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(employee_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    relationship TEXT,
    address TEXT,
    phone_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Remove old emergency contact columns from employees table
ALTER TABLE employees
DROP COLUMN emergency_contact_name;

ALTER TABLE employees
DROP COLUMN emergency_contact_phone; 