-- Add comprehensive SEO and default fields to event_categories table
-- These will serve as defaults for events in each category

ALTER TABLE event_categories
ADD COLUMN IF NOT EXISTS short_description TEXT,
ADD COLUMN IF NOT EXISTS long_description TEXT,
ADD COLUMN IF NOT EXISTS highlights JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS gallery_image_urls JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS poster_image_url TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_image_url TEXT,
ADD COLUMN IF NOT EXISTS promo_video_url TEXT,
ADD COLUMN IF NOT EXISTS highlight_video_urls JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS default_doors_time VARCHAR(10),
ADD COLUMN IF NOT EXISTS default_last_entry_time VARCHAR(10),
ADD COLUMN IF NOT EXISTS default_booking_url TEXT,
ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]'::jsonb;

-- Add comments for clarity
COMMENT ON COLUMN event_categories.short_description IS 'Default short description for events in this category';
COMMENT ON COLUMN event_categories.long_description IS 'Default long description for events in this category';
COMMENT ON COLUMN event_categories.highlights IS 'Default highlights/bullet points for events';
COMMENT ON COLUMN event_categories.meta_title IS 'Default SEO meta title template';
COMMENT ON COLUMN event_categories.keywords IS 'Default keywords for SEO';
COMMENT ON COLUMN event_categories.gallery_image_urls IS 'Default gallery images';
COMMENT ON COLUMN event_categories.poster_image_url IS 'Default poster image URL';
COMMENT ON COLUMN event_categories.thumbnail_image_url IS 'Default thumbnail image URL';
COMMENT ON COLUMN event_categories.promo_video_url IS 'Default promotional video URL';
COMMENT ON COLUMN event_categories.highlight_video_urls IS 'Default highlight video URLs';
COMMENT ON COLUMN event_categories.default_duration_minutes IS 'Default event duration in minutes';
COMMENT ON COLUMN event_categories.default_doors_time IS 'Default doors opening time before event';
COMMENT ON COLUMN event_categories.default_last_entry_time IS 'Default last entry time';
COMMENT ON COLUMN event_categories.default_booking_url IS 'Default external booking URL';
COMMENT ON COLUMN event_categories.faqs IS 'Default FAQs for events in this category';