-- Create departments table for dynamic department management
CREATE TABLE IF NOT EXISTS departments (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with existing departments
INSERT INTO departments (name, label, sort_order) VALUES
  ('bar', 'Bar', 0),
  ('kitchen', 'Kitchen', 1),
  ('runner', 'Runner', 2)
ON CONFLICT (name) DO NOTHING;

-- Enable RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read departments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'departments' AND policyname = 'Authenticated users can read departments'
  ) THEN
    CREATE POLICY "Authenticated users can read departments"
      ON departments FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Allow settings managers to insert/update/delete departments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'departments' AND policyname = 'Settings managers can manage departments'
  ) THEN
    CREATE POLICY "Settings managers can manage departments"
      ON departments FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
