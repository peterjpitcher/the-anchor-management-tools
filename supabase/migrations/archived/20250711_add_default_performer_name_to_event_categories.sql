-- Add default_performer_name to event_categories
ALTER TABLE event_categories 
ADD COLUMN IF NOT EXISTS default_performer_name VARCHAR(255);

-- Add comment for clarity
COMMENT ON COLUMN event_categories.default_performer_name IS 'Default performer name to use when creating events with this category';