-- Phase 1: Essential Event SEO Fields
-- This migration adds critical SEO fields to the events table

-- Add content fields
ALTER TABLE events
ADD COLUMN IF NOT EXISTS slug VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS short_description TEXT,
ADD COLUMN IF NOT EXISTS long_description TEXT,
ADD COLUMN IF NOT EXISTS highlights JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS meta_description TEXT,
ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]'::jsonb;

-- Add rich media fields
ALTER TABLE events
ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
ADD COLUMN IF NOT EXISTS gallery_image_urls JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS poster_image_url TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_image_url TEXT,
ADD COLUMN IF NOT EXISTS promo_video_url TEXT,
ADD COLUMN IF NOT EXISTS highlight_video_urls JSONB DEFAULT '[]'::jsonb;

-- Add timing fields
ALTER TABLE events
ADD COLUMN IF NOT EXISTS doors_time TIME,
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS last_entry_time TIME;

-- Create FAQ table for events
CREATE TABLE IF NOT EXISTS event_faqs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for FAQ lookups
CREATE INDEX IF NOT EXISTS idx_event_faqs_event_id ON event_faqs(event_id);
CREATE INDEX IF NOT EXISTS idx_event_faqs_sort_order ON event_faqs(event_id, sort_order);

-- Generate slugs for existing events
UPDATE events 
SET slug = LOWER(
    REGEXP_REPLACE(
        REGEXP_REPLACE(
            name || '-' || TO_CHAR(date, 'month-yyyy'),
            '[^a-zA-Z0-9\s-]', '', 'g'
        ),
        '\s+', '-', 'g'
    )
)
WHERE slug IS NULL;

-- Make slug NOT NULL after populating
ALTER TABLE events 
ALTER COLUMN slug SET NOT NULL;

-- Create unique index on slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events(slug);

-- Add check constraint for duration
ALTER TABLE events
ADD CONSTRAINT check_duration_positive 
CHECK (duration_minutes IS NULL OR duration_minutes > 0);

-- Update image_urls to gallery_image_urls for existing data
UPDATE events 
SET gallery_image_urls = image_urls::jsonb
WHERE image_urls IS NOT NULL 
AND gallery_image_urls = '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN events.slug IS 'URL-friendly identifier for the event (SEO)';
COMMENT ON COLUMN events.short_description IS 'Brief description (50-150 chars) for list views and meta descriptions';
COMMENT ON COLUMN events.long_description IS 'Full HTML/Markdown content for event page';
COMMENT ON COLUMN events.highlights IS 'JSON array of bullet points highlighting key features';
COMMENT ON COLUMN events.meta_title IS 'Custom page title for SEO (optional)';
COMMENT ON COLUMN events.meta_description IS 'Custom meta description for SEO (optional)';
COMMENT ON COLUMN events.keywords IS 'JSON array of target keywords for SEO';
COMMENT ON COLUMN events.hero_image_url IS 'Main hero image (1200x630 minimum for Open Graph)';
COMMENT ON COLUMN events.gallery_image_urls IS 'JSON array of additional photo URLs';
COMMENT ON COLUMN events.poster_image_url IS 'Event poster/flyer URL if different from hero';
COMMENT ON COLUMN events.thumbnail_image_url IS 'Square image for list views (400x400)';
COMMENT ON COLUMN events.promo_video_url IS 'YouTube/Vimeo URL for promotional video';
COMMENT ON COLUMN events.highlight_video_urls IS 'JSON array of previous event highlight video URLs';
COMMENT ON COLUMN events.doors_time IS 'Door opening time if different from start';
COMMENT ON COLUMN events.duration_minutes IS 'Event duration in minutes';
COMMENT ON COLUMN events.last_entry_time IS 'Last entry time for the event';

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for event_faqs
CREATE TRIGGER update_event_faqs_updated_at BEFORE UPDATE ON event_faqs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add RLS policies for event_faqs
ALTER TABLE event_faqs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read FAQs
CREATE POLICY "Allow authenticated users to read event FAQs"
    ON event_faqs FOR SELECT
    TO authenticated
    USING (true);

-- Allow users with events:edit permission to manage FAQs
CREATE POLICY "Allow users with events:edit to manage FAQs"
    ON event_faqs FOR ALL
    TO authenticated
    USING (user_has_permission(auth.uid(), 'events', 'edit'));

-- Add sort_order field to event_categories (was missing)
ALTER TABLE event_categories
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Update sort_order for existing categories
WITH numbered_categories AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) * 10 as new_order
    FROM event_categories
    WHERE sort_order = 0 OR sort_order IS NULL
)
UPDATE event_categories
SET sort_order = numbered_categories.new_order
FROM numbered_categories
WHERE event_categories.id = numbered_categories.id;

-- Create index for category sorting
CREATE INDEX IF NOT EXISTS idx_event_categories_sort_order ON event_categories(sort_order);