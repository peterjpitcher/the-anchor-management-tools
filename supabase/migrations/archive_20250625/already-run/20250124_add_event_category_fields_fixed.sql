-- This is a fixed version that skips already-applied changes

-- Check if constraints already exist before adding them
DO $$ 
BEGIN
    -- Add check constraint for event status only if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_default_event_status'
    ) THEN
        ALTER TABLE event_categories
        ADD CONSTRAINT check_default_event_status 
        CHECK (default_event_status IN ('scheduled', 'cancelled', 'postponed', 'rescheduled'));
    END IF;

    -- Add check constraint for performer type only if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_default_performer_type'
    ) THEN
        ALTER TABLE event_categories
        ADD CONSTRAINT check_default_performer_type 
        CHECK (default_performer_type IN ('MusicGroup', 'Person', 'TheaterGroup', 'DanceGroup', 'ComedyGroup', 'Organization') OR default_performer_type IS NULL);
    END IF;
END $$;

-- Create index on slug only if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_event_categories_slug ON event_categories(slug);

-- Update some example categories with new fields (only if needed)
UPDATE event_categories 
SET 
    default_end_time = CASE 
        WHEN default_end_time IS NULL AND default_start_time IS NOT NULL 
        THEN default_start_time + INTERVAL '3 hours'
        ELSE default_end_time
    END,
    meta_description = CASE 
        WHEN meta_description IS NULL 
        THEN 'Join us for ' || name || ' events at The Anchor'
        ELSE meta_description
    END
WHERE default_start_time IS NOT NULL;