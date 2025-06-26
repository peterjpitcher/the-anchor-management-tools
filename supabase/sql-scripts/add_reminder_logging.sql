-- Create a reminder_logs table to track reminder processing
CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  log_type TEXT CHECK (log_type IN ('cron_start', 'cron_end', 'booking_found', 'sms_sent', 'sms_failed', 'error')),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  template_type TEXT,
  reminder_type TEXT,
  message TEXT,
  error_details JSONB,
  metadata JSONB
);

-- Create indexes
CREATE INDEX idx_reminder_logs_created_at ON reminder_logs(created_at DESC);
CREATE INDEX idx_reminder_logs_booking_id ON reminder_logs(booking_id);
CREATE INDEX idx_reminder_logs_log_type ON reminder_logs(log_type);

-- Enable RLS
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to read logs
CREATE POLICY "Authenticated users can read reminder logs" ON reminder_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- Create function to log reminder activity
CREATE OR REPLACE FUNCTION log_reminder_activity(
  p_log_type TEXT,
  p_message TEXT,
  p_booking_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_template_type TEXT DEFAULT NULL,
  p_reminder_type TEXT DEFAULT NULL,
  p_error_details JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO reminder_logs (
    log_type,
    message,
    booking_id,
    event_id,
    customer_id,
    template_type,
    reminder_type,
    error_details,
    metadata
  ) VALUES (
    p_log_type,
    p_message,
    p_booking_id,
    p_event_id,
    p_customer_id,
    p_template_type,
    p_reminder_type,
    p_error_details,
    p_metadata
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION log_reminder_activity TO authenticated;

-- Add comment
COMMENT ON TABLE reminder_logs IS 'Logs all reminder processing activity for debugging and monitoring';
COMMENT ON FUNCTION log_reminder_activity IS 'Logs reminder processing activity with detailed context';