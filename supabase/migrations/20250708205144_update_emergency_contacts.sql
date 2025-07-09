-- Description: Add mobile number and priority fields to employee_emergency_contacts table

-- Add new columns to emergency contacts table
ALTER TABLE employee_emergency_contacts
ADD COLUMN IF NOT EXISTS mobile_number TEXT,
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Other' CHECK (priority IN ('Primary', 'Secondary', 'Other'));

-- Add mobile validation constraint
ALTER TABLE employee_emergency_contacts
ADD CONSTRAINT emergency_contacts_mobile_check 
CHECK (mobile_number IS NULL OR mobile_number ~ '^(\+44|0)?7\d{9}$');

-- Add comments for documentation
COMMENT ON COLUMN employee_emergency_contacts.mobile_number IS 'Mobile phone number (separate from main phone number)';
COMMENT ON COLUMN employee_emergency_contacts.priority IS 'Contact priority: Primary, Secondary, or Other';