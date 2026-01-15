-- Simplify performer submissions table to match the minimal /open-mic interest form.
-- Keeps only name, contact details, description, consent, and admin workflow fields.

-- Drop indexes that reference removed columns
DROP INDEX IF EXISTS public.idx_performer_submissions_has_links;
DROP INDEX IF EXISTS public.idx_performer_submissions_performer_types_gin;

-- Drop constraints that reference removed columns
ALTER TABLE public.performer_submissions
  DROP CONSTRAINT IF EXISTS performer_submissions_performer_types_nonempty,
  DROP CONSTRAINT IF EXISTS performer_submissions_availability_general,
  DROP CONSTRAINT IF EXISTS performer_submissions_can_start_around_8pm,
  DROP CONSTRAINT IF EXISTS performer_submissions_content_rating,
  DROP CONSTRAINT IF EXISTS performer_submissions_music_originals_covers,
  DROP CONSTRAINT IF EXISTS performer_submissions_set_length_minutes,
  DROP CONSTRAINT IF EXISTS performer_submissions_setup_time_minutes,
  DROP CONSTRAINT IF EXISTS performer_submissions_performer_count;

-- Drop columns no longer collected
ALTER TABLE public.performer_submissions
  DROP COLUMN IF EXISTS use_real_name,
  DROP COLUMN IF EXISTS act_name,
  DROP COLUMN IF EXISTS base_location,
  DROP COLUMN IF EXISTS performer_types,
  DROP COLUMN IF EXISTS performer_type_other,
  DROP COLUMN IF EXISTS links,
  DROP COLUMN IF EXISTS has_links,
  DROP COLUMN IF EXISTS social_handles,
  DROP COLUMN IF EXISTS experience_level,
  DROP COLUMN IF EXISTS pronouns,
  DROP COLUMN IF EXISTS accessibility_notes,
  DROP COLUMN IF EXISTS availability_general,
  DROP COLUMN IF EXISTS can_start_around_8pm,
  DROP COLUMN IF EXISTS availability,
  DROP COLUMN IF EXISTS set_length_minutes,
  DROP COLUMN IF EXISTS content_rating,
  DROP COLUMN IF EXISTS music_originals_covers,
  DROP COLUMN IF EXISTS genres,
  DROP COLUMN IF EXISTS tech_needs,
  DROP COLUMN IF EXISTS tech_needs_other,
  DROP COLUMN IF EXISTS bring_own_gear,
  DROP COLUMN IF EXISTS setup_time_minutes,
  DROP COLUMN IF EXISTS performer_count,
  DROP COLUMN IF EXISTS special_requirements,
  DROP COLUMN IF EXISTS consent_marketing,
  DROP COLUMN IF EXISTS consent_media;
