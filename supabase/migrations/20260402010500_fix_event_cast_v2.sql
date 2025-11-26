-- Fix update_event_transaction
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
  -- 1. Update Event
  UPDATE events SET
    name = COALESCE(p_event_data->>'name', name),
    date = COALESCE((p_event_data->>'date')::DATE, date),
    time = COALESCE(p_event_data->>'time', time),
    capacity = (p_event_data->>'capacity')::INTEGER,
    category_id = (p_event_data->>'category_id')::UUID,
    short_description = p_event_data->>'short_description',
    long_description = p_event_data->>'long_description',
    brief = p_event_data->>'brief',
    
    -- Removed ::TEXT[] cast, assuming columns are JSONB
    highlights = COALESCE(p_event_data->'highlights', highlights),
    keywords = COALESCE(p_event_data->'keywords', keywords),
    
    slug = COALESCE(p_event_data->>'slug', slug),
    meta_title = p_event_data->>'meta_title',
    meta_description = p_event_data->>'meta_description',
    end_time = (p_event_data->>'end_time')::TIME,
    duration_minutes = (p_event_data->>'duration_minutes')::INTEGER,
    doors_time = (p_event_data->>'doors_time')::TIME,
    last_entry_time = (p_event_data->>'last_entry_time')::TIME,
    event_status = COALESCE(p_event_data->>'event_status', event_status),
    performer_name = p_event_data->>'performer_name',
    performer_type = p_event_data->>'performer_type',
    price = COALESCE((p_event_data->>'price')::DECIMAL, price),
    is_free = COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free),
    booking_url = p_event_data->>'booking_url',
    hero_image_url = p_event_data->>'hero_image_url',
    thumbnail_image_url = p_event_data->>'thumbnail_image_url',
    poster_image_url = p_event_data->>'poster_image_url',
    promo_video_url = p_event_data->>'promo_video_url',
    
    -- Removed ::TEXT[] cast
    highlight_video_urls = COALESCE(p_event_data->'highlight_video_urls', highlight_video_urls),
    gallery_image_urls = COALESCE(p_event_data->'gallery_image_urls', gallery_image_urls)

  WHERE id = p_event_id;

  -- 2. Update FAQs (if provided)
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

  -- 3. Return the updated event
  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_event_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Fix create_event_transaction
CREATE OR REPLACE FUNCTION create_event_transaction(
  p_event_data JSONB,
  p_faqs JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_event_record JSONB;
BEGIN
  -- 1. Insert Event
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
    performer_name,
    performer_type,
    price,
    is_free,
    booking_url,
    hero_image_url,
    thumbnail_image_url,
    poster_image_url,
    promo_video_url,
    highlight_video_urls,
    gallery_image_urls
  ) VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::DATE,
    COALESCE(p_event_data->>'time', '00:00'),
    (p_event_data->>'capacity')::INTEGER,
    (p_event_data->>'category_id')::UUID,
    p_event_data->>'short_description',
    p_event_data->>'long_description',
    p_event_data->>'brief',
    -- Removed ::TEXT[] casts
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
    p_event_data->>'performer_name',
    p_event_data->>'performer_type',
    COALESCE((p_event_data->>'price')::DECIMAL, 0),
    COALESCE((p_event_data->>'is_free')::BOOLEAN, false),
    p_event_data->>'booking_url',
    p_event_data->>'hero_image_url',
    p_event_data->>'thumbnail_image_url',
    p_event_data->>'poster_image_url',
    p_event_data->>'promo_video_url',
    -- Removed ::TEXT[] casts
    COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB),
    COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB)
  )
  RETURNING id INTO v_event_id;

  -- 2. Insert FAQs (if any)
  IF jsonb_array_length(p_faqs) > 0 THEN
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

  -- 3. Return the created event
  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = v_event_id;

  RETURN v_event_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;