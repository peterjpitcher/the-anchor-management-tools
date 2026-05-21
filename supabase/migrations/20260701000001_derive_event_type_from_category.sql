-- Migration: derive_event_type_from_category
--
-- Three-part fix for event_type consistency:
--
-- 1. Fix update_event_transaction RPC: remove the COALESCE fallback on
--    event_type so that sending null/empty via p_event_data actually CLEARS
--    the column instead of silently keeping the old value.
--
-- 2. Backfill: set event_type = category slug for every event that has a
--    category_id.  This makes the denormalised column consistent with the
--    canonical category relationship.
--
-- 3. Cleanup: NULL-out event_type on events that have no category, removing
--    stale values left from before category assignment was enforced.

-- ============================================================
-- Part 1: Recreate update_event_transaction with the event_type fix
-- ============================================================
-- ONLY change vs the 20260615000000 version: the event_type CASE line
-- now uses NULLIF(TRIM(...), '') WITHOUT the outer COALESCE(..., event_type),
-- so sending null or '' actually clears the field.

CREATE OR REPLACE FUNCTION update_event_transaction(
  p_event_id UUID,
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_record JSONB;
BEGIN
  UPDATE events SET
    name              = CASE WHEN p_event_data ? 'name'              THEN COALESCE(p_event_data->>'name', name) ELSE name END,
    date              = CASE WHEN p_event_data ? 'date'              THEN COALESCE((p_event_data->>'date')::DATE, date) ELSE date END,
    time              = CASE WHEN p_event_data ? 'time'              THEN COALESCE(p_event_data->>'time', time) ELSE time END,
    capacity          = CASE WHEN p_event_data ? 'capacity'          THEN (p_event_data->>'capacity')::INTEGER ELSE capacity END,
    category_id       = CASE WHEN p_event_data ? 'category_id'       THEN (p_event_data->>'category_id')::UUID ELSE category_id END,
    short_description = CASE WHEN p_event_data ? 'short_description' THEN p_event_data->>'short_description' ELSE short_description END,
    long_description  = CASE WHEN p_event_data ? 'long_description'  THEN p_event_data->>'long_description' ELSE long_description END,
    brief             = CASE WHEN p_event_data ? 'brief'             THEN p_event_data->>'brief' ELSE brief END,
    highlights        = CASE WHEN p_event_data ? 'highlights'        THEN COALESCE(p_event_data->'highlights', highlights) ELSE highlights END,
    keywords          = CASE WHEN p_event_data ? 'keywords'          THEN COALESCE(p_event_data->'keywords', keywords) ELSE keywords END,
    slug              = CASE WHEN p_event_data ? 'slug'              THEN COALESCE(p_event_data->>'slug', slug) ELSE slug END,
    meta_title        = CASE WHEN p_event_data ? 'meta_title'        THEN p_event_data->>'meta_title' ELSE meta_title END,
    meta_description  = CASE WHEN p_event_data ? 'meta_description'  THEN p_event_data->>'meta_description' ELSE meta_description END,
    end_time          = CASE WHEN p_event_data ? 'end_time'          THEN (p_event_data->>'end_time')::TIME ELSE end_time END,
    duration_minutes  = CASE WHEN p_event_data ? 'duration_minutes'  THEN (p_event_data->>'duration_minutes')::INTEGER ELSE duration_minutes END,
    doors_time        = CASE WHEN p_event_data ? 'doors_time'        THEN (p_event_data->>'doors_time')::TIME ELSE doors_time END,
    last_entry_time   = CASE WHEN p_event_data ? 'last_entry_time'   THEN (p_event_data->>'last_entry_time')::TIME ELSE last_entry_time END,
    event_status      = CASE WHEN p_event_data ? 'event_status'      THEN COALESCE(p_event_data->>'event_status', event_status) ELSE event_status END,
    booking_mode      = CASE WHEN p_event_data ? 'booking_mode'      THEN COALESCE(NULLIF(p_event_data->>'booking_mode', ''), booking_mode) ELSE booking_mode END,
    booking_open      = CASE WHEN p_event_data ? 'booking_open'      THEN COALESCE((p_event_data->>'booking_open')::BOOLEAN, booking_open) ELSE booking_open END,
    booking_url       = CASE WHEN p_event_data ? 'booking_url'       THEN p_event_data->>'booking_url' ELSE booking_url END,
    event_type        = CASE WHEN p_event_data ? 'event_type'        THEN NULLIF(TRIM(p_event_data->>'event_type'), '') ELSE event_type END,
    performer_name    = CASE WHEN p_event_data ? 'performer_name'    THEN p_event_data->>'performer_name' ELSE performer_name END,
    performer_type    = CASE WHEN p_event_data ? 'performer_type'    THEN p_event_data->>'performer_type' ELSE performer_type END,
    price             = CASE WHEN p_event_data ? 'price'             THEN COALESCE((p_event_data->>'price')::DECIMAL, price) ELSE price END,
    price_per_seat    = CASE WHEN p_event_data ? 'price_per_seat'    THEN (p_event_data->>'price_per_seat')::NUMERIC(10,2) ELSE price_per_seat END,
    is_free           = CASE WHEN p_event_data ? 'is_free'           THEN COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free) ELSE is_free END,
    payment_mode      = CASE WHEN p_event_data ? 'payment_mode'      THEN COALESCE(NULLIF(p_event_data->>'payment_mode', ''), payment_mode) ELSE payment_mode END,
    start_datetime    = CASE WHEN p_event_data ? 'start_datetime'    THEN (p_event_data->>'start_datetime')::TIMESTAMPTZ ELSE start_datetime END,
    hero_image_url    = CASE WHEN p_event_data ? 'hero_image_url'    THEN p_event_data->>'hero_image_url' ELSE hero_image_url END,
    thumbnail_image_url = CASE WHEN p_event_data ? 'thumbnail_image_url' THEN p_event_data->>'thumbnail_image_url' ELSE thumbnail_image_url END,
    poster_image_url  = CASE WHEN p_event_data ? 'poster_image_url'  THEN p_event_data->>'poster_image_url' ELSE poster_image_url END,
    promo_video_url   = CASE WHEN p_event_data ? 'promo_video_url'   THEN p_event_data->>'promo_video_url' ELSE promo_video_url END,
    highlight_video_urls = CASE WHEN p_event_data ? 'highlight_video_urls' THEN COALESCE(p_event_data->'highlight_video_urls', highlight_video_urls) ELSE highlight_video_urls END,
    gallery_image_urls   = CASE WHEN p_event_data ? 'gallery_image_urls'   THEN COALESCE(p_event_data->'gallery_image_urls', gallery_image_urls) ELSE gallery_image_urls END,
    facebook_event_name        = CASE WHEN p_event_data ? 'facebook_event_name'        THEN p_event_data->>'facebook_event_name' ELSE facebook_event_name END,
    facebook_event_description = CASE WHEN p_event_data ? 'facebook_event_description' THEN p_event_data->>'facebook_event_description' ELSE facebook_event_description END,
    gbp_event_title            = CASE WHEN p_event_data ? 'gbp_event_title'            THEN p_event_data->>'gbp_event_title' ELSE gbp_event_title END,
    gbp_event_description      = CASE WHEN p_event_data ? 'gbp_event_description'      THEN p_event_data->>'gbp_event_description' ELSE gbp_event_description END,
    opentable_experience_title       = CASE WHEN p_event_data ? 'opentable_experience_title'       THEN p_event_data->>'opentable_experience_title' ELSE opentable_experience_title END,
    opentable_experience_description = CASE WHEN p_event_data ? 'opentable_experience_description' THEN p_event_data->>'opentable_experience_description' ELSE opentable_experience_description END,
    primary_keywords   = CASE WHEN p_event_data ? 'primary_keywords'   THEN COALESCE(p_event_data->'primary_keywords', primary_keywords) ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN COALESCE(p_event_data->'secondary_keywords', secondary_keywords) ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN COALESCE(p_event_data->'local_seo_keywords', local_seo_keywords) ELSE local_seo_keywords END,
    image_alt_text     = CASE WHEN p_event_data ? 'image_alt_text'     THEN p_event_data->>'image_alt_text' ELSE image_alt_text END,
    social_copy_whatsapp    = CASE WHEN p_event_data ? 'social_copy_whatsapp'    THEN p_event_data->>'social_copy_whatsapp' ELSE social_copy_whatsapp END,
    previous_event_summary  = CASE WHEN p_event_data ? 'previous_event_summary'  THEN p_event_data->>'previous_event_summary' ELSE previous_event_summary END,
    attendance_note         = CASE WHEN p_event_data ? 'attendance_note'         THEN p_event_data->>'attendance_note' ELSE attendance_note END,
    cancellation_policy     = CASE WHEN p_event_data ? 'cancellation_policy'     THEN p_event_data->>'cancellation_policy' ELSE cancellation_policy END,
    accessibility_notes     = CASE WHEN p_event_data ? 'accessibility_notes'     THEN p_event_data->>'accessibility_notes' ELSE accessibility_notes END,
    promo_sms_enabled       = CASE WHEN p_event_data ? 'promo_sms_enabled'       THEN (p_event_data->>'promo_sms_enabled')::BOOLEAN ELSE promo_sms_enabled END,
    bookings_enabled        = CASE WHEN p_event_data ? 'bookings_enabled'        THEN (p_event_data->>'bookings_enabled')::BOOLEAN ELSE bookings_enabled END
  WHERE id = p_event_id;

  -- Only touch FAQs when p_faqs IS NOT NULL (preserves existing FAQs on partial updates)
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;

    IF jsonb_array_length(p_faqs) > 0 THEN
      INSERT INTO event_faqs (
        event_id,
        question,
        answer,
        sort_order
      )
      SELECT
        p_event_id,
        item->>'question',
        item->>'answer',
        COALESCE((item->>'sort_order')::INTEGER, 0)
      FROM jsonb_array_elements(p_faqs) AS item;
    END IF;
  END IF;

  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_event_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- ============================================================
-- Part 2: Backfill event_type from category slug
-- ============================================================
-- For every event that has a category, set event_type to the category's slug.
-- IS DISTINCT FROM avoids no-op updates on rows already correct.
-- Temporarily drop chk_event_date_reasonable because updating event_type
-- on old events (date > 1 year ago) re-validates the check constraint even
-- though we are not changing the date column. Re-added as NOT VALID so it
-- applies to future writes without failing on historical rows.

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS chk_event_date_reasonable;

UPDATE public.events e
SET event_type = ec.slug
FROM public.event_categories ec
WHERE e.category_id = ec.id
  AND e.event_type IS DISTINCT FROM ec.slug;

-- ============================================================
-- Part 3: Clear stale event_type on uncategorised events
-- ============================================================
-- Events with no category should not carry a stale event_type value.

UPDATE public.events
SET event_type = NULL
WHERE category_id IS NULL
  AND NULLIF(TRIM(event_type), '') IS NOT NULL;

-- Re-add the constraint as NOT VALID: enforced on new inserts/updates
-- but does not re-validate existing historical rows.
ALTER TABLE public.events
  ADD CONSTRAINT chk_event_date_reasonable
  CHECK (date >= (CURRENT_DATE - '1 year'::interval)) NOT VALID;
