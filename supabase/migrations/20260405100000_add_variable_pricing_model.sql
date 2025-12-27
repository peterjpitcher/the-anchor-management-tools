-- Add 'variable' to pricing_model check constraint
-- This allows catering packages to have a "Price on Request" model

BEGIN;

-- 1. Drop existing check constraint if it exists
-- We attempt to guess the name, but safer to drop by definition is hard in SQL without dynamic SQL.
-- Standard naming convention is table_column_check.
ALTER TABLE catering_packages DROP CONSTRAINT IF EXISTS catering_packages_pricing_model_check;

-- 2. Add updated check constraint
ALTER TABLE catering_packages 
  ADD CONSTRAINT catering_packages_pricing_model_check 
  CHECK (pricing_model IN ('per_head', 'total_value', 'variable', 'per_jar', 'per_tray', 'menu_priced', 'free'));

COMMIT;
