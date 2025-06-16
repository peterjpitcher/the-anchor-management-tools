-- Create audit logs table for tracking sensitive operations

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT,
  operation_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  operation_status TEXT NOT NULL CHECK (operation_status IN ('success', 'failure')),
  ip_address INET,
  user_agent TEXT,
  old_values JSONB,
  new_values JSONB,
  error_message TEXT,
  additional_info JSONB
);

-- Create indexes for common queries
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_operation_type ON audit_logs(operation_type);

-- Prevent deletion of audit logs
CREATE OR REPLACE FUNCTION prevent_audit_log_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_audit_log_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_deletion();

-- Prevent updates to audit logs (make them immutable)
CREATE OR REPLACE FUNCTION prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be modified';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_audit_log_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_update();

-- Function to log operations
CREATE OR REPLACE FUNCTION log_audit_event(
  p_user_id UUID,
  p_user_email TEXT,
  p_operation_type TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_operation_status TEXT,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_additional_info JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id,
    user_email,
    operation_type,
    resource_type,
    resource_id,
    operation_status,
    ip_address,
    user_agent,
    old_values,
    new_values,
    error_message,
    additional_info
  ) VALUES (
    p_user_id,
    p_user_email,
    p_operation_type,
    p_resource_type,
    p_resource_id,
    p_operation_status,
    p_ip_address,
    p_user_agent,
    p_old_values,
    p_new_values,
    p_error_message,
    p_additional_info
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT SELECT ON audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION log_audit_event TO authenticated;

-- Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view audit logs if they have admin role
CREATE POLICY "Admin users can view audit logs" ON audit_logs
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Comments
COMMENT ON TABLE audit_logs IS 'Immutable audit log for tracking sensitive operations';
COMMENT ON COLUMN audit_logs.operation_type IS 'Type of operation: login, logout, create, update, delete, view, export, etc.';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource: employee, customer, financial_details, health_records, attachment, etc.';
COMMENT ON COLUMN audit_logs.old_values IS 'Previous values before update (for update operations)';
COMMENT ON COLUMN audit_logs.new_values IS 'New values after update (for create/update operations)';