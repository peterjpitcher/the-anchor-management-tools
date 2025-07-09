-- Description: Create employee_onboarding_checklist table for tracking onboarding process completion

-- Create the onboarding checklist table
CREATE TABLE IF NOT EXISTS employee_onboarding_checklist (
  employee_id UUID PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
  wheniwork_invite_sent BOOLEAN DEFAULT FALSE,
  wheniwork_invite_date DATE,
  private_whatsapp_added BOOLEAN DEFAULT FALSE,
  private_whatsapp_date DATE,
  team_whatsapp_added BOOLEAN DEFAULT FALSE,
  team_whatsapp_date DATE,
  till_system_setup BOOLEAN DEFAULT FALSE,
  till_system_date DATE,
  training_flow_setup BOOLEAN DEFAULT FALSE,
  training_flow_date DATE,
  employment_agreement_drafted BOOLEAN DEFAULT FALSE,
  employment_agreement_date DATE,
  employee_agreement_accepted BOOLEAN DEFAULT FALSE,
  employee_agreement_accepted_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE employee_onboarding_checklist ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view onboarding checklist based on employee permissions" 
ON employee_onboarding_checklist FOR SELECT 
USING (user_has_permission(auth.uid(), 'employees', 'view'));

CREATE POLICY "Users can manage onboarding checklist based on employee permissions" 
ON employee_onboarding_checklist FOR ALL 
USING (user_has_permission(auth.uid(), 'employees', 'edit'));

-- Add trigger for updated_at
CREATE TRIGGER update_employee_onboarding_checklist_updated_at
  BEFORE UPDATE ON employee_onboarding_checklist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE employee_onboarding_checklist IS 'Tracks completion of employee onboarding tasks';
COMMENT ON COLUMN employee_onboarding_checklist.wheniwork_invite_sent IS 'Whether WhenIWork scheduling app invite has been sent';
COMMENT ON COLUMN employee_onboarding_checklist.wheniwork_invite_date IS 'Date WhenIWork invite was sent';
COMMENT ON COLUMN employee_onboarding_checklist.private_whatsapp_added IS 'Whether employee added to private WhatsApp group';
COMMENT ON COLUMN employee_onboarding_checklist.private_whatsapp_date IS 'Date added to private WhatsApp';
COMMENT ON COLUMN employee_onboarding_checklist.team_whatsapp_added IS 'Whether employee added to team WhatsApp group';
COMMENT ON COLUMN employee_onboarding_checklist.team_whatsapp_date IS 'Date added to team WhatsApp';
COMMENT ON COLUMN employee_onboarding_checklist.till_system_setup IS 'Whether employee has been set up on till system';
COMMENT ON COLUMN employee_onboarding_checklist.till_system_date IS 'Date set up on till system';
COMMENT ON COLUMN employee_onboarding_checklist.training_flow_setup IS 'Whether training has been set up in Flow system';
COMMENT ON COLUMN employee_onboarding_checklist.training_flow_date IS 'Date training was set up';
COMMENT ON COLUMN employee_onboarding_checklist.employment_agreement_drafted IS 'Whether employment agreement has been drafted';
COMMENT ON COLUMN employee_onboarding_checklist.employment_agreement_date IS 'Date employment agreement was drafted';
COMMENT ON COLUMN employee_onboarding_checklist.employee_agreement_accepted IS 'Whether employee has accepted the agreement';
COMMENT ON COLUMN employee_onboarding_checklist.employee_agreement_accepted_date IS 'Timestamp when employee accepted the agreement';