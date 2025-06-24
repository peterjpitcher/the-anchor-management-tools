-- Add missing RLS policies for business_hours and special_hours tables
-- These tables need to be manageable by users with settings:manage permission

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Public can read business hours" ON business_hours;
DROP POLICY IF EXISTS "Authorized users can manage business hours" ON business_hours;
DROP POLICY IF EXISTS "Public can read special hours" ON special_hours;
DROP POLICY IF EXISTS "Authorized users can manage special hours" ON special_hours;

-- Create comprehensive policies for business_hours
CREATE POLICY "Public can read business hours" ON business_hours
  FOR SELECT USING (true);

CREATE POLICY "Authorized users can manage business hours" ON business_hours
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_has_permission(auth.uid(), 'settings', 'manage')
      WHERE user_has_permission = true
    )
  );

-- Create comprehensive policies for special_hours  
CREATE POLICY "Public can read special hours" ON special_hours
  FOR SELECT USING (true);

CREATE POLICY "Authorized users can manage special hours" ON special_hours
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_has_permission(auth.uid(), 'settings', 'manage')
      WHERE user_has_permission = true
    )
  );