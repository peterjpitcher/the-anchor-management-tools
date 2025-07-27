-- Fix kitchen hours data consistency issues
-- This migration addresses the problem where special_hours entries have kitchen hours set
-- even when the kitchen is supposed to be closed

-- First, let's check if the is_kitchen_closed column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'special_hours' AND column_name = 'is_kitchen_closed'
  ) THEN
    ALTER TABLE special_hours ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN special_hours.is_kitchen_closed IS 'Explicitly marks if kitchen is closed even if restaurant is open';
  END IF;
END $$;

-- Fix special hours entries where kitchen is marked as closed in the note
-- but still has kitchen hours set
UPDATE special_hours
SET 
  kitchen_opens = NULL,
  kitchen_closes = NULL,
  is_kitchen_closed = TRUE
WHERE 
  note ILIKE '%kitchen closed%'
  AND (kitchen_opens IS NOT NULL OR kitchen_closes IS NOT NULL);

-- Also handle any entries that say "Kitchen Closed" exactly
UPDATE special_hours
SET 
  kitchen_opens = NULL,
  kitchen_closes = NULL,
  is_kitchen_closed = TRUE
WHERE 
  LOWER(TRIM(note)) = 'kitchen closed';

-- Log what we fixed for audit purposes
DO $$
DECLARE
  fixed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fixed_count
  FROM special_hours
  WHERE is_kitchen_closed = TRUE
  AND note ILIKE '%kitchen closed%';
  
  IF fixed_count > 0 THEN
    RAISE NOTICE 'Fixed % special hours entries with kitchen closed status', fixed_count;
  END IF;
END $$;

-- Add check constraint to ensure data consistency going forward
-- If is_kitchen_closed is true, then kitchen hours should be null
ALTER TABLE special_hours DROP CONSTRAINT IF EXISTS check_kitchen_closed_consistency;
ALTER TABLE special_hours ADD CONSTRAINT check_kitchen_closed_consistency
  CHECK (
    (is_kitchen_closed = TRUE AND kitchen_opens IS NULL AND kitchen_closes IS NULL)
    OR
    (is_kitchen_closed = FALSE)
  );

-- Also add the same column to business_hours for consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'business_hours' AND column_name = 'is_kitchen_closed'
  ) THEN
    ALTER TABLE business_hours ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN business_hours.is_kitchen_closed IS 'Explicitly marks if kitchen is closed on this day even if restaurant is open';
  END IF;
END $$;

-- Add the same constraint to business_hours
ALTER TABLE business_hours DROP CONSTRAINT IF EXISTS check_kitchen_closed_consistency;
ALTER TABLE business_hours ADD CONSTRAINT check_kitchen_closed_consistency
  CHECK (
    (is_kitchen_closed = TRUE AND kitchen_opens IS NULL AND kitchen_closes IS NULL)
    OR
    (is_kitchen_closed = FALSE)
  );