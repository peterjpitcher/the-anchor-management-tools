-- Description: Create employee_employment_terms table for pay frequency, probation tracking, and training status

-- Create the employment terms table
CREATE TABLE IF NOT EXISTS employee_employment_terms (
  employee_id UUID PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
  pay_frequency TEXT CHECK (pay_frequency IN ('Monthly', 'Weekly', 'Fortnightly')),
  pay_day TEXT,
  probation_start_date DATE,
  probation_end_date DATE,
  probation_extended BOOLEAN DEFAULT FALSE,
  probation_extension_reason TEXT,
  training_completed BOOLEAN DEFAULT FALSE,
  training_completion_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE employee_employment_terms ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view employment terms based on employee permissions" 
ON employee_employment_terms FOR SELECT 
USING (user_has_permission(auth.uid(), 'employees', 'view'));

CREATE POLICY "Users can manage employment terms based on employee permissions" 
ON employee_employment_terms FOR ALL 
USING (user_has_permission(auth.uid(), 'employees', 'edit'));

-- Add trigger for updated_at
CREATE TRIGGER update_employee_employment_terms_updated_at
  BEFORE UPDATE ON employee_employment_terms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE employee_employment_terms IS 'Employee payment frequency, probation period, and training tracking';
COMMENT ON COLUMN employee_employment_terms.pay_frequency IS 'How often the employee is paid';
COMMENT ON COLUMN employee_employment_terms.pay_day IS 'When payment is made (e.g., "Last weekday of month", "Every Friday")';
COMMENT ON COLUMN employee_employment_terms.probation_start_date IS 'Start date of probationary period';
COMMENT ON COLUMN employee_employment_terms.probation_end_date IS 'Expected end date of probationary period';
COMMENT ON COLUMN employee_employment_terms.probation_extended IS 'Whether probation has been extended';
COMMENT ON COLUMN employee_employment_terms.probation_extension_reason IS 'Reason for probation extension if applicable';
COMMENT ON COLUMN employee_employment_terms.training_completed IS 'Whether all required training has been completed';
COMMENT ON COLUMN employee_employment_terms.training_completion_date IS 'Date when all training was completed';