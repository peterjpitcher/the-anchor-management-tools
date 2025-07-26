-- Add is_kitchen_closed column to special_hours table
-- This allows venues to indicate the kitchen is closed while the venue remains open

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'special_hours' AND column_name = 'is_kitchen_closed'
  ) THEN
    ALTER TABLE special_hours ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add comment for clarity
COMMENT ON COLUMN special_hours.is_kitchen_closed IS 'Indicates if the kitchen is closed while the venue remains open';