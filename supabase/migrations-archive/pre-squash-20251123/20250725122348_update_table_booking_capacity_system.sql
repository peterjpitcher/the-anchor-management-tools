-- Description: Update table booking system to use fixed capacity instead of table assignments

-- Update the check_table_availability function to use fixed capacity
CREATE OR REPLACE FUNCTION "public"."check_table_availability"(
  "p_date" "date", 
  "p_time" time without time zone, 
  "p_party_size" integer, 
  "p_duration_minutes" integer DEFAULT 120, 
  "p_exclude_booking_id" "uuid" DEFAULT NULL::"uuid"
) RETURNS TABLE(
  "available_capacity" integer, 
  "tables_available" integer[], 
  "is_available" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
DECLARE
  v_day_of_week INTEGER;
  v_total_capacity INTEGER;
  v_booked_capacity INTEGER;
  v_available_capacity INTEGER;
  v_restaurant_capacity CONSTANT INTEGER := 50; -- Fixed restaurant capacity
BEGIN
  -- Get day of week (0 = Sunday)
  v_day_of_week := EXTRACT(DOW FROM p_date);
  
  -- Use fixed restaurant capacity instead of table configuration
  v_total_capacity := v_restaurant_capacity;
  
  -- Get booked capacity for the time slot
  SELECT COALESCE(SUM(party_size), 0) INTO v_booked_capacity
  FROM table_bookings
  WHERE booking_date = p_date
    AND status IN ('confirmed', 'pending_payment')
    AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
    AND (
      -- Check for time overlap
      (booking_time <= p_time AND (booking_time + (duration_minutes || ' minutes')::INTERVAL) > p_time)
      OR
      (p_time <= booking_time AND (p_time + (p_duration_minutes || ' minutes')::INTERVAL) > booking_time)
    );
  
  v_available_capacity := v_total_capacity - v_booked_capacity;
  
  RETURN QUERY
  SELECT 
    v_available_capacity,
    ARRAY[]::INTEGER[], -- No specific table assignments needed
    v_available_capacity >= p_party_size;
END;
$$;

-- Add comment to function
COMMENT ON FUNCTION "public"."check_table_availability" IS 'Checks table booking availability using fixed restaurant capacity of 50 people';

-- Optional: Add a system_settings table for configurable capacity (for future use)
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert restaurant capacity setting
INSERT INTO system_settings (key, value, description)
VALUES ('restaurant_capacity', '{"max_capacity": 50}', 'Maximum restaurant capacity for table bookings')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS on system_settings
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for system_settings
CREATE POLICY "Staff can view system settings" ON system_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage system settings" ON system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();