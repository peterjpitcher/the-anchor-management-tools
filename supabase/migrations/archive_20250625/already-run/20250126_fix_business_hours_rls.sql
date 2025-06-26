-- Add missing RLS policies for business_hours and special_hours tables
-- These tables need to be manageable by users with settings:manage permission

-- Drop existing read-only policies
DROP POLICY IF EXISTS "Public can read business hours" ON business_hours;
DROP POLICY IF EXISTS "Public can read special hours" ON special_hours;

-- Create comprehensive policies for business_hours
CREATE POLICY "Public can read business hours" ON business_hours
  FOR SELECT USING (true);

CREATE POLICY "Authorized users can manage business hours" ON business_hours
  FOR ALL USING (user_has_permission(auth.uid(), 'settings', 'manage'));

-- Create comprehensive policies for special_hours  
CREATE POLICY "Public can read special hours" ON special_hours
  FOR SELECT USING (true);

CREATE POLICY "Authorized users can manage special hours" ON special_hours
  FOR ALL USING (user_has_permission(auth.uid(), 'settings', 'manage'));