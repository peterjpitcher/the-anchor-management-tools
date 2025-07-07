-- Create customer labels table
CREATE TABLE IF NOT EXISTS customer_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6B7280', -- Hex color for UI display
  icon VARCHAR(50), -- Icon name for UI
  auto_apply_rules JSONB, -- Rules for automatic application
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create customer label assignments table
CREATE TABLE IF NOT EXISTS customer_label_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES customer_labels(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  auto_assigned BOOLEAN DEFAULT FALSE,
  notes TEXT,
  UNIQUE(customer_id, label_id)
);

-- Create indexes
CREATE INDEX idx_customer_label_assignments_customer_id ON customer_label_assignments(customer_id);
CREATE INDEX idx_customer_label_assignments_label_id ON customer_label_assignments(label_id);

-- Enable RLS
ALTER TABLE customer_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_label_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for customer_labels
CREATE POLICY "Users with customer view permission can view labels" ON customer_labels
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action = 'view'
    )
  );

CREATE POLICY "Users with customer manage permission can create labels" ON customer_labels
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action = 'manage'
    )
  );

CREATE POLICY "Users with customer manage permission can update labels" ON customer_labels
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action = 'manage'
    )
  );

CREATE POLICY "Users with customer manage permission can delete labels" ON customer_labels
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action = 'manage'
    )
  );

-- RLS policies for customer_label_assignments
CREATE POLICY "Users with customer view permission can view label assignments" ON customer_label_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action = 'view'
    )
  );

CREATE POLICY "Users with customer edit permission can assign labels" ON customer_label_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action IN ('edit', 'manage')
    )
  );

CREATE POLICY "Users with customer edit permission can remove label assignments" ON customer_label_assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.module_name = 'customers'
      AND p.action IN ('edit', 'manage')
    )
  );

-- Insert default labels
INSERT INTO customer_labels (name, description, color, icon, auto_apply_rules) VALUES
  ('VIP', 'High-value customers who attend frequently', '#10B981', 'star', 
   '{"min_attendance": 10, "min_categories": 3}'::jsonb),
  
  ('Regular', 'Customers who attend events regularly', '#3B82F6', 'users', 
   '{"min_attendance": 5, "days_back": 90}'::jsonb),
  
  ('New Customer', 'Recently joined customers', '#8B5CF6', 'user-plus', 
   '{"max_days_since_first": 30}'::jsonb),
  
  ('At Risk', 'Previously active customers who haven''t attended recently', '#EF4444', 'alert-triangle', 
   '{"min_attendance": 3, "days_inactive": 60}'::jsonb),
  
  ('Birthday Club', 'Customers who celebrate birthdays at the venue', '#F59E0B', 'cake', 
   '{"manual_only": true}'::jsonb),
  
  ('Corporate', 'Business/corporate customers', '#6B7280', 'briefcase', 
   '{"manual_only": true}'::jsonb),
  
  ('Special Needs', 'Customers requiring special accommodations', '#EC4899', 'heart', 
   '{"manual_only": true}'::jsonb),
  
  ('Banned', 'Customers who are not welcome', '#991B1B', 'ban', 
   '{"manual_only": true}'::jsonb);

-- Function to apply labels based on rules
CREATE OR REPLACE FUNCTION apply_customer_labels_retroactively()
RETURNS TABLE (
  customer_id UUID,
  applied_labels TEXT[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  label_record RECORD;
  customer_record RECORD;
  should_apply BOOLEAN;
  applied_count INTEGER := 0;
BEGIN
  -- Loop through each label with auto-apply rules
  FOR label_record IN 
    SELECT * FROM customer_labels 
    WHERE auto_apply_rules IS NOT NULL 
    AND NOT (auto_apply_rules->>'manual_only' = 'true')
  LOOP
    -- Apply VIP label
    IF label_record.name = 'VIP' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied based on attendance history'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        GROUP BY ccs.customer_id
        HAVING SUM(times_attended) >= COALESCE((label_record.auto_apply_rules->>'min_attendance')::int, 10)
        AND COUNT(DISTINCT category_id) >= COALESCE((label_record.auto_apply_rules->>'min_categories')::int, 3)
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    -- Apply Regular label
    ELSIF label_record.name = 'Regular' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied based on recent attendance'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        AND ccs.last_attended_date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY ccs.customer_id
        HAVING SUM(times_attended) >= COALESCE((label_record.auto_apply_rules->>'min_attendance')::int, 5)
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    -- Apply New Customer label
    ELSIF label_record.name = 'New Customer' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied based on join date'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        AND ccs.first_attended_date >= CURRENT_DATE - INTERVAL '30 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    -- Apply At Risk label
    ELSIF label_record.name = 'At Risk' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied - customer hasn''t attended recently'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        GROUP BY ccs.customer_id
        HAVING SUM(times_attended) >= COALESCE((label_record.auto_apply_rules->>'min_attendance')::int, 3)
        AND MAX(last_attended_date) < CURRENT_DATE - INTERVAL '60 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
    END IF;
    
    GET DIAGNOSTICS applied_count = ROW_COUNT;
    RAISE NOTICE 'Applied % label to % customers', label_record.name, applied_count;
  END LOOP;
  
  -- Return summary of applied labels
  RETURN QUERY
  SELECT 
    cla.customer_id,
    array_agg(cl.name ORDER BY cl.name) as applied_labels
  FROM customer_label_assignments cla
  JOIN customer_labels cl ON cla.label_id = cl.id
  WHERE cla.auto_assigned = true
  GROUP BY cla.customer_id;
END;
$$;

-- Function to get customer labels
CREATE OR REPLACE FUNCTION get_customer_labels(p_customer_id UUID)
RETURNS TABLE (
  label_id UUID,
  name VARCHAR(255),
  color VARCHAR(7),
  icon VARCHAR(50),
  assigned_at TIMESTAMPTZ,
  auto_assigned BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cl.id as label_id,
    cl.name,
    cl.color,
    cl.icon,
    cla.assigned_at,
    cla.auto_assigned
  FROM customer_labels cl
  JOIN customer_label_assignments cla ON cl.id = cla.label_id
  WHERE cla.customer_id = p_customer_id
  ORDER BY cl.name;
END;
$$;