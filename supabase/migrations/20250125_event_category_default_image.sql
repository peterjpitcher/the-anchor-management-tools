-- Add default image URL to event categories
ALTER TABLE event_categories
ADD COLUMN IF NOT EXISTS default_image_url TEXT;