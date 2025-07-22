-- Description: Update Nikki's event categories - split into Games Night and Karaoke Night
-- 
-- This migration:
-- 1. Updates the existing "Drag Cabaret with Nikki Manfadge" category to "Nikki's Games Night"
-- 2. Creates a new category for "Nikki's Karaoke Night"
-- 3. Updates descriptions to reflect the new branding and format

-- Update existing Drag Cabaret category to Nikki's Games Night
UPDATE event_categories
SET 
  name = 'Nikki''s Games Night',
  slug = 'nikkis-games-night',
  description = 'Classic TV gameshows with a drag twist! Join Nikki Manfadge for Blankety Blank, Name That Tune, Play Your Cards Right, and more. Interactive entertainment with prizes and laughs. Wednesdays 7-10pm.',
  default_start_time = '19:00:00', -- Default start time 7pm
  default_end_time = '22:00:00', -- Default end time 10pm
  -- Keep the same color (pink) and icon (sparkles) as they still fit
  updated_at = NOW()
WHERE id = 'f192afe3-ca45-4c53-980a-9653ed8711d7';

-- Create new category for Nikki's Karaoke Night (only if it doesn't already exist)
INSERT INTO event_categories (
  id,
  name,
  slug,
  description,
  short_description,
  long_description,
  meta_title,
  meta_description,
  keywords,
  highlights,
  faqs,
  color,
  icon,
  sort_order,
  is_active,
  default_performer_type,
  default_start_time,
  default_end_time,
  default_reminder_hours,
  default_is_free,
  default_price,
  default_capacity,
  default_event_status,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'Nikki''s Karaoke Night',
  'nikkis-karaoke-night',
  'Interactive singing with drag entertainment! Two microphones, 50,000+ songs, duets with Nikki, lip sync battles, and group singalongs. Props and costumes provided. Fridays 8-11pm.',
  'Interactive karaoke with drag queen Nikki Manfadge - Fridays 8-11pm',
  'Join Nikki Manfadge for an unforgettable karaoke experience! With two microphones, over 50,000 songs to choose from, and Nikki''s fabulous hosting, every Friday night becomes a celebration. Whether you want to belt out power ballads, duet with Nikki, or participate in lip sync battles, this is your stage. Props and costumes provided for those feeling extra fabulous!',
  'Nikki''s Karaoke Night at The Anchor | Drag Entertainment | Fridays 8-11pm',
  'Experience Nikki''s Karaoke Night at The Anchor, Stanwell Moor. Interactive singing with drag queen Nikki Manfadge every Friday 8-11pm. Free entry, 50,000+ songs, duets, lip sync battles. Book your table now!',
  '["karaoke", "drag queen", "nikki manfadge", "friday night entertainment", "stanwell moor", "the anchor pub", "live entertainment", "karaoke night", "drag entertainment", "free entry"]'::jsonb,
  '["Two microphones available", "50,000+ song catalogue", "Duets with Nikki", "Lip sync battle hour", "Props and costumes provided", "Group singalongs", "Free entry"]'::jsonb,
  '[{"question": "Is there an entry fee?", "answer": "No! Entry is completely free. Just book your table in advance."}, {"question": "Can I request any song?", "answer": "Yes! We have over 50,000 songs in our catalogue covering all genres and decades."}, {"question": "Do I have to sing?", "answer": "Not at all! You can just come to enjoy the show and support others."}, {"question": "Is it suitable for all ages?", "answer": "All ages are welcome but expect adult language and themes throughout the night."}, {"question": "Can I book for a group?", "answer": "Absolutely! We recommend booking in advance for groups. Call 01753 682707."}]'::jsonb,
  '#9333EA', -- Purple color to differentiate from Games Night
  'MicrophoneIcon', -- Microphone icon for karaoke
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM event_categories), -- Add to end of sort order
  true, -- Active
  'Person', -- Performer type for individual performer
  '20:00:00', -- Default start time 8pm
  '23:00:00', -- Default end time 11pm
  24, -- Default reminder 24 hours before
  true, -- Free entry
  0.00, -- No ticket price
  50, -- Maximum capacity
  'scheduled', -- Default status
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  long_description = EXCLUDED.long_description,
  meta_title = EXCLUDED.meta_title,
  meta_description = EXCLUDED.meta_description,
  keywords = EXCLUDED.keywords,
  highlights = EXCLUDED.highlights,
  faqs = EXCLUDED.faqs,
  default_start_time = EXCLUDED.default_start_time,
  default_end_time = EXCLUDED.default_end_time,
  updated_at = NOW();

-- Add note about the migration
COMMENT ON COLUMN event_categories.name IS 'Event category names. Updated 2025-01-19: Split "Drag Cabaret with Nikki Manfadge" into "Nikki''s Games Night" (Wednesdays) and "Nikki''s Karaoke Night" (Fridays)';