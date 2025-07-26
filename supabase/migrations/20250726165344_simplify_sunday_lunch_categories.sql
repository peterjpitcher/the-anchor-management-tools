-- Description: Simplify Sunday lunch menu categories to only main and side

-- First, update all 'extra' items to 'side'
UPDATE sunday_lunch_menu_items 
SET category = 'side' 
WHERE category = 'extra';

-- Update table_booking_items to change 'extra' to 'side'
UPDATE table_booking_items 
SET item_type = 'side' 
WHERE item_type = 'extra';

-- Drop existing constraints
ALTER TABLE sunday_lunch_menu_items 
DROP CONSTRAINT IF EXISTS sunday_lunch_menu_items_category_check;

ALTER TABLE table_booking_items 
DROP CONSTRAINT IF EXISTS table_booking_items_item_type_check;

-- Add new constraints with only main and side
ALTER TABLE sunday_lunch_menu_items 
ADD CONSTRAINT sunday_lunch_menu_items_category_check 
CHECK (category IN ('main', 'side'));

ALTER TABLE table_booking_items 
ADD CONSTRAINT table_booking_items_item_type_check 
CHECK (item_type IN ('main', 'side'));

-- Update Cauliflower Cheese to ensure it's marked as a side with price
UPDATE sunday_lunch_menu_items 
SET 
  category = 'side',
  price = 3.99,
  description = 'Creamy mature cheddar sauce, baked until golden and bubbling'
WHERE name = 'Cauliflower Cheese';

-- Add a note about pricing for sides
COMMENT ON COLUMN sunday_lunch_menu_items.price IS 'Price for the item. Sides included with mains should be 0, extra sides should have a price';

-- Log the migration
INSERT INTO audit_logs (
  operation_type,
  resource_type,
  operation_status,
  additional_info,
  created_at
) VALUES (
  'migrate',
  'sunday_lunch_menu',
  'success',
  jsonb_build_object(
    'migration', 'simplify_categories',
    'changes', 'Removed dessert and extra categories, simplified to main and side only'
  ),
  NOW()
);