-- Create table for daily cashup targets
CREATE TABLE IF NOT EXISTS cashup_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 1 = Monday, etc.
  target_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  -- Constraint to prevent duplicate effective dates for the same day/site
  UNIQUE(site_id, day_of_week, effective_from)
);

-- Add RLS policies
ALTER TABLE cashup_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cashup targets"
  ON cashup_targets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can insert cashup targets"
  ON cashup_targets FOR INSERT
  TO authenticated
  WITH CHECK (true); -- Should refine based on permissions later

-- Create index for faster lookups
CREATE INDEX idx_cashup_targets_lookup ON cashup_targets(site_id, day_of_week, effective_from DESC);
