-- Rename package_type to serving_style and add category column
-- Refactor catering types to simplify API logic

BEGIN;

-- 1. Rename existing column
ALTER TABLE catering_packages RENAME COLUMN package_type TO serving_style;

-- 2. Add new category column
ALTER TABLE catering_packages ADD COLUMN category TEXT CHECK (category IN ('food', 'drink', 'addon'));

-- 3. Migrate data
-- Map existing styles to categories
UPDATE catering_packages
SET category = CASE
  WHEN serving_style = 'drinks' THEN 'drink'
  WHEN serving_style IN ('canapes', 'other') THEN 'addon'
  ELSE 'food' -- buffet, sit-down, pizza default to food
END;

-- 4. Enforce NOT NULL on category after population
ALTER TABLE catering_packages ALTER COLUMN category SET NOT NULL;

-- 5. Rename constraint for consistency (optional but good practice)
-- Note: Postgres doesn't automatically rename constraints when column changes
ALTER TABLE catering_packages DROP CONSTRAINT IF EXISTS catering_packages_package_type_check;
ALTER TABLE catering_packages ADD CONSTRAINT catering_packages_serving_style_check 
  CHECK (serving_style IN ('buffet', 'sit-down', 'canapes', 'drinks', 'pizza', 'other'));

COMMIT;
