-- Create tables table
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number VARCHAR(10) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on table number
CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_table_number ON tables(LOWER(table_number));

-- Create table_combinations table
CREATE TABLE IF NOT EXISTS table_combinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  total_capacity INTEGER NOT NULL CHECK (total_capacity > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on combination name
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_combinations_name ON table_combinations(LOWER(name));

-- Create table_combination_tables junction table
CREATE TABLE IF NOT EXISTS table_combination_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combination_id UUID NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(combination_id, table_id)
);

-- Enable RLS
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combination_tables ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Staff can view tables" ON tables;
DROP POLICY IF EXISTS "Managers can manage tables" ON tables;
DROP POLICY IF EXISTS "Staff can view table combinations" ON table_combinations;
DROP POLICY IF EXISTS "Managers can manage table combinations" ON table_combinations;
DROP POLICY IF EXISTS "Staff can view table combination tables" ON table_combination_tables;
DROP POLICY IF EXISTS "Managers can manage table combination tables" ON table_combination_tables;

-- Create RLS policies for tables
CREATE POLICY "Staff can view tables" ON tables
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage tables" ON tables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create RLS policies for table_combinations
CREATE POLICY "Staff can view table combinations" ON table_combinations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage table combinations" ON table_combinations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create RLS policies for table_combination_tables
CREATE POLICY "Staff can view table combination tables" ON table_combination_tables
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage table combination tables" ON table_combination_tables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_tables_updated_at ON tables;
DROP TRIGGER IF EXISTS update_table_combinations_updated_at ON table_combinations;

-- Create updated_at triggers
CREATE TRIGGER update_tables_updated_at
  BEFORE UPDATE ON tables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_table_combinations_updated_at
  BEFORE UPDATE ON table_combinations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert some default tables
INSERT INTO tables (table_number, capacity, notes) VALUES
  ('1', 4, 'Near window'),
  ('2', 4, 'Near window'),
  ('3', 2, 'Bar seating'),
  ('4', 2, 'Bar seating'),
  ('5', 6, 'Round table'),
  ('6', 4, 'Corner booth'),
  ('7', 4, 'Main floor'),
  ('8', 4, 'Main floor'),
  ('9', 2, 'High top'),
  ('10', 2, 'High top')
ON CONFLICT (LOWER(table_number)) DO NOTHING;