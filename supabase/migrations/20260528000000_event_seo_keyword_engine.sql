-- SEO Keyword Engine: add keyword/SEO columns to events + event_categories,
-- and rebuild both RPC functions to include ALL columns.

-- ============================================================
-- 1. New columns on events
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS primary_keywords   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS secondary_keywords JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS local_seo_keywords JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS image_alt_text     TEXT,
  ADD COLUMN IF NOT EXISTS social_copy_whatsapp    TEXT,
  ADD COLUMN IF NOT EXISTS previous_event_summary  TEXT,
  ADD COLUMN IF NOT EXISTS attendance_note         TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_policy     TEXT,
  ADD COLUMN IF NOT EXISTS accessibility_notes     TEXT;

-- ============================================================
-- 2. New columns on event_categories
-- ============================================================
ALTER TABLE public.event_categories
  ADD COLUMN IF NOT EXISTS primary_keywords   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS secondary_keywords JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS local_seo_keywords JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS image_alt_text     TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_policy TEXT,
  ADD COLUMN IF NOT EXISTS accessibility_notes TEXT;

-- ============================================================
-- 3. CREATE OR REPLACE create_event_transaction
--    Includes ALL existing columns + 9 new ones
-- ============================================================
CREATE OR REPLACE FUNCTION create_event_transaction(
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_event_record JSONB;
BEGIN
  INSERT INTO events (
    name,
    date,
    time,
    capacity,
    category_id,
    short_description,
    long_description,
    brief,
    highlights,
    keywords,
    slug,
    meta_title,
    meta_description,
    end_time,
    duration_minutes,
    doors_time,
    last_entry_time,
    event_status,
    booking_mode,
    booking_open,
    booking_url,
    event_type,
    performer_name,
    performer_type,
    price,
    price_per_seat,
    is_free,
    payment_mode,
    start_datetime,
    hero_image_url,
    thumbnail_image_url,
    poster_image_url,
    promo_video_url,
    highlight_video_urls,
    gallery_image_urls,
    facebook_event_name,
    facebook_event_description,
    gbp_event_title,
    gbp_event_description,
    opentable_experience_title,
    opentable_experience_description,
    -- new SEO keyword engine columns
    primary_keywords,
    secondary_keywords,
    local_seo_keywords,
    image_alt_text,
    social_copy_whatsapp,
    previous_event_summary,
    attendance_note,
    cancellation_policy,
    accessibility_notes
  ) VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::DATE,
    COALESCE(p_event_data->>'time', '00:00'),
    (p_event_data->>'capacity')::INTEGER,
    (p_event_data->>'category_id')::UUID,
    p_event_data->>'short_description',
    p_event_data->>'long_description',
    p_event_data->>'brief',
    COALESCE(p_event_data->'highlights', '[]'::JSONB),
    COALESCE(p_event_data->'keywords', '[]'::JSONB),
    p_event_data->>'slug',
    p_event_data->>'meta_title',
    p_event_data->>'meta_description',
    (p_event_data->>'end_time')::TIME,
    (p_event_data->>'duration_minutes')::INTEGER,
    (p_event_data->>'doors_time')::TIME,
    (p_event_data->>'last_entry_time')::TIME,
    COALESCE(p_event_data->>'event_status', 'scheduled'),
    COALESCE(NULLIF(p_event_data->>'booking_mode', ''), 'table'),
    COALESCE((p_event_data->>'booking_open')::BOOLEAN, true),
    p_event_data->>'booking_url',
    NULLIF(TRIM(p_event_data->>'event_type'), ''),
    p_event_data->>'performer_name',
    p_event_data->>'performer_type',
    COALESCE((p_event_data->>'price')::DECIMAL, 0),
    (p_event_data->>'price_per_seat')::NUMERIC(10,2),
    COALESCE((p_event_data->>'is_free')::BOOLEAN, false),
    COALESCE(NULLIF(p_event_data->>'payment_mode', ''), 'free'),
    (p_event_data->>'start_datetime')::TIMESTAMPTZ,
    p_event_data->>'hero_image_url',
    p_event_data->>'thumbnail_image_url',
    p_event_data->>'poster_image_url',
    p_event_data->>'promo_video_url',
    COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB),
    COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB),
    p_event_data->>'facebook_event_name',
    p_event_data->>'facebook_event_description',
    p_event_data->>'gbp_event_title',
    p_event_data->>'gbp_event_description',
    p_event_data->>'opentable_experience_title',
    p_event_data->>'opentable_experience_description',
    -- new SEO keyword engine values
    COALESCE(p_event_data->'primary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'secondary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'local_seo_keywords', '[]'::JSONB),
    p_event_data->>'image_alt_text',
    p_event_data->>'social_copy_whatsapp',
    p_event_data->>'previous_event_summary',
    p_event_data->>'attendance_note',
    p_event_data->>'cancellation_policy',
    p_event_data->>'accessibility_notes'
  )
  RETURNING id INTO v_event_id;

  -- Insert FAQs if provided
  IF p_faqs IS NOT NULL AND jsonb_array_length(p_faqs) > 0 THEN
    INSERT INTO event_faqs (
      event_id,
      question,
      answer,
      sort_order
    )
    SELECT
      v_event_id,
      item->>'question',
      item->>'answer',
      COALESCE((item->>'sort_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_faqs) AS item;
  END IF;

  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = v_event_id;

  RETURN v_event_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- ============================================================
-- 4. CREATE OR REPLACE update_event_transaction
--    Uses CASE WHEN p_event_data ? 'col' pattern for safe partial updates.
--    FAQs only touched when p_faqs IS NOT NULL (preserves existing).
-- ============================================================
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
    event_type        = CASE WHEN p_event_data ? 'event_type'        THEN COALESCE(NULLIF(TRIM(p_event_data->>'event_type'), ''), event_type) ELSE event_type END,
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
    -- new SEO keyword engine columns
    primary_keywords   = CASE WHEN p_event_data ? 'primary_keywords'   THEN COALESCE(p_event_data->'primary_keywords', primary_keywords) ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN COALESCE(p_event_data->'secondary_keywords', secondary_keywords) ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN COALESCE(p_event_data->'local_seo_keywords', local_seo_keywords) ELSE local_seo_keywords END,
    image_alt_text     = CASE WHEN p_event_data ? 'image_alt_text'     THEN p_event_data->>'image_alt_text' ELSE image_alt_text END,
    social_copy_whatsapp    = CASE WHEN p_event_data ? 'social_copy_whatsapp'    THEN p_event_data->>'social_copy_whatsapp' ELSE social_copy_whatsapp END,
    previous_event_summary  = CASE WHEN p_event_data ? 'previous_event_summary'  THEN p_event_data->>'previous_event_summary' ELSE previous_event_summary END,
    attendance_note         = CASE WHEN p_event_data ? 'attendance_note'         THEN p_event_data->>'attendance_note' ELSE attendance_note END,
    cancellation_policy     = CASE WHEN p_event_data ? 'cancellation_policy'     THEN p_event_data->>'cancellation_policy' ELSE cancellation_policy END,
    accessibility_notes     = CASE WHEN p_event_data ? 'accessibility_notes'     THEN p_event_data->>'accessibility_notes' ELSE accessibility_notes END
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
