-- Migration: Simplify image fields and add missing fields to event_categories
-- This migration:
-- 1. Adds missing SEO/content fields to event_categories
-- 2. Converts multiple image fields to single image_url field
-- 3. Migrates existing image data

-- Step 1: Add missing fields to event_categories table
ALTER TABLE event_categories
ADD COLUMN IF NOT EXISTS short_description TEXT,
ADD COLUMN IF NOT EXISTS long_description TEXT,
ADD COLUMN IF NOT EXISTS highlights TEXT[],
ADD COLUMN IF NOT EXISTS meta_title TEXT,
ADD COLUMN IF NOT EXISTS keywords TEXT[],
ADD COLUMN IF NOT EXISTS promo_video_url TEXT,
ADD COLUMN IF NOT EXISTS highlight_video_urls TEXT[],
ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS default_doors_time TIME,
ADD COLUMN IF NOT EXISTS default_last_entry_time TIME,
ADD COLUMN IF NOT EXISTS default_booking_url TEXT,
ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]'::jsonb;

-- Step 2: Add new image_url column to both tables
ALTER TABLE events
ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE event_categories
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Step 3: Migrate existing image data only if old columns exist
DO $$
BEGIN
    -- Check if old columns exist in events table
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'hero_image_url') THEN
        -- Migrate events image data
        UPDATE events
        SET image_url = COALESCE(
            hero_image_url,
            thumbnail_image_url,
            poster_image_url,
            CASE 
                WHEN gallery_image_urls IS NOT NULL AND jsonb_typeof(gallery_image_urls) = 'array' AND jsonb_array_length(gallery_image_urls) > 0 
                THEN gallery_image_urls->>0 
                ELSE NULL 
            END
        )
        WHERE image_url IS NULL;
        
        -- Drop old columns from events
        ALTER TABLE events
        DROP COLUMN IF EXISTS hero_image_url,
        DROP COLUMN IF EXISTS thumbnail_image_url,
        DROP COLUMN IF EXISTS poster_image_url,
        DROP COLUMN IF EXISTS gallery_image_urls;
    END IF;
    
    -- Check if old columns exist in event_categories table
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'event_categories' AND column_name = 'default_image_url') THEN
        -- Migrate categories image data
        UPDATE event_categories
        SET image_url = COALESCE(
            default_image_url,
            thumbnail_image_url,
            poster_image_url
        )
        WHERE image_url IS NULL;
        
        -- Drop old columns from event_categories
        ALTER TABLE event_categories
        DROP COLUMN IF EXISTS default_image_url,
        DROP COLUMN IF EXISTS thumbnail_image_url,
        DROP COLUMN IF EXISTS poster_image_url,
        DROP COLUMN IF EXISTS gallery_image_urls;
    END IF;
END $$;

-- Step 4: Add comments for clarity
COMMENT ON COLUMN events.image_url IS 'Single square image for the event';
COMMENT ON COLUMN event_categories.image_url IS 'Default square image for events in this category';

-- Step 5: Create indexes on new image_url columns for performance
CREATE INDEX IF NOT EXISTS idx_events_image_url ON events(image_url) WHERE image_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_categories_image_url ON event_categories(image_url) WHERE image_url IS NOT NULL;