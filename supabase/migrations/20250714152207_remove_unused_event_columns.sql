-- Description: Remove unused columns from events table (description, image_urls, is_recurring, recurrence_rule, parent_event_id, price_currency) and menu_items table (price_currency)

-- Drop columns from events table that are not being used
ALTER TABLE events 
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS image_urls,
  DROP COLUMN IF EXISTS is_recurring,
  DROP COLUMN IF EXISTS recurrence_rule,
  DROP COLUMN IF EXISTS parent_event_id,
  DROP COLUMN IF EXISTS price_currency;

-- Also drop the foreign key constraint for parent_event_id if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'events' 
    AND constraint_name = 'events_parent_event_id_fkey'
  ) THEN
    ALTER TABLE events DROP CONSTRAINT events_parent_event_id_fkey;
  END IF;
END $$;

-- Drop price_currency from menu_items table (all prices are in GBP)
ALTER TABLE menu_items 
  DROP COLUMN IF EXISTS price_currency;