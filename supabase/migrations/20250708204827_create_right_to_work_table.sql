-- Description: Create employee_right_to_work table for UK right to work documentation tracking

-- Create the right to work table
CREATE TABLE IF NOT EXISTS employee_right_to_work (
  employee_id UUID PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('List A', 'List B')),
  document_details TEXT,
  verification_date DATE NOT NULL,
  document_expiry_date DATE,
  follow_up_date DATE,
  verified_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE employee_right_to_work ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view right to work based on employee permissions" 
ON employee_right_to_work FOR SELECT 
USING (user_has_permission(auth.uid(), 'employees', 'view'));

CREATE POLICY "Users can manage right to work based on employee permissions" 
ON employee_right_to_work FOR ALL 
USING (user_has_permission(auth.uid(), 'employees', 'edit'));

-- Add trigger for updated_at
CREATE TRIGGER update_employee_right_to_work_updated_at
  BEFORE UPDATE ON employee_right_to_work
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE employee_right_to_work IS 'UK right to work documentation verification tracking';
COMMENT ON COLUMN employee_right_to_work.document_type IS 'List A (permanent right) or List B (temporary right)';
COMMENT ON COLUMN employee_right_to_work.document_details IS 'Specific document type details (e.g., "British Passport", "Biometric Residence Permit")';
COMMENT ON COLUMN employee_right_to_work.verification_date IS 'Date the documents were verified';
COMMENT ON COLUMN employee_right_to_work.document_expiry_date IS 'Expiry date of the document (if applicable)';
COMMENT ON COLUMN employee_right_to_work.follow_up_date IS 'Date for next verification check (for temporary rights)';
COMMENT ON COLUMN employee_right_to_work.verified_by_user_id IS 'User who performed the verification';