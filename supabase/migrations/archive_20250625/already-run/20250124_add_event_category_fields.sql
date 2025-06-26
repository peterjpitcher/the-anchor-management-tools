-- Add new fields to event_categories table for enhanced API support
ALTER TABLE event_categories 
ADD COLUMN IF NOT EXISTS default_end_time TIME,
ADD COLUMN IF NOT EXISTS default_price DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS default_is_free BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS default_performer_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS default_event_status VARCHAR(50) DEFAULT 'scheduled',
ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE,
ADD COLUMN IF NOT EXISTS meta_description TEXT;

-- Generate slugs for existing categories
UPDATE event_categories 
SET slug = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

-- Make slug NOT NULL after populating
ALTER TABLE event_categories 
ALTER COLUMN slug SET NOT NULL;

-- Add check constraint for event status
ALTER TABLE event_categories
ADD CONSTRAINT check_default_event_status 
CHECK (default_event_status IN ('scheduled', 'cancelled', 'postponed', 'rescheduled'));

-- Add check constraint for performer type
ALTER TABLE event_categories
ADD CONSTRAINT check_default_performer_type 
CHECK (default_performer_type IN ('MusicGroup', 'Person', 'TheaterGroup', 'DanceGroup', 'ComedyGroup', 'Organization') OR default_performer_type IS NULL);

-- Create index on slug for faster lookups
CREATE INDEX IF NOT EXISTS idx_event_categories_slug ON event_categories(slug);

-- Update some example categories with new fields (optional)
UPDATE event_categories 
SET 
    default_end_time = default_start_time + INTERVAL '3 hours',
    default_price = 0,
    default_is_free = true,
    meta_description = 'Join us for ' || name || ' events at The Anchor'
WHERE default_start_time IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN event_categories.default_end_time IS 'Default end time for events in this category';
COMMENT ON COLUMN event_categories.default_price IS 'Default ticket price for events in this category';
COMMENT ON COLUMN event_categories.default_is_free IS 'Whether events in this category are free by default';
COMMENT ON COLUMN event_categories.default_performer_type IS 'Default Schema.org performer type for this category';
COMMENT ON COLUMN event_categories.default_event_status IS 'Default status for new events in this category';
COMMENT ON COLUMN event_categories.slug IS 'URL-friendly identifier for the category';
COMMENT ON COLUMN event_categories.meta_description IS 'SEO meta description for the category page';