-- Update the create_short_link function to use the new domain format
CREATE OR REPLACE FUNCTION create_short_link(
  p_destination_url TEXT,
  p_link_type TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_custom_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_short_code TEXT;
  v_id UUID;
  v_full_url TEXT;
  v_exists BOOLEAN;
BEGIN
  -- If custom code is provided, use it
  IF p_custom_code IS NOT NULL THEN
    v_short_code := p_custom_code;
    
    -- Check availability
    SELECT EXISTS(SELECT 1 FROM short_links WHERE short_code = v_short_code) INTO v_exists;
    IF v_exists THEN
      RAISE EXCEPTION 'Custom code already in use' USING ERRCODE = '23505';
    END IF;
  ELSE
    -- Generate random 6-char code
    LOOP
      v_short_code := lower(substring(md5(random()::text), 1, 6));
      
      SELECT EXISTS(SELECT 1 FROM short_links WHERE short_code = v_short_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
  END IF;

  INSERT INTO short_links (
    short_code,
    destination_url,
    link_type,
    metadata,
    expires_at
  )
  VALUES (
    v_short_code,
    p_destination_url,
    p_link_type,
    p_metadata,
    p_expires_at
  )
  RETURNING id INTO v_id;

  -- Use the new domain format: the-anchor.pub/l/CODE
  v_full_url := 'https://the-anchor.pub/l/' || v_short_code;

  RETURN jsonb_build_object(
    'id', v_id,
    'short_code', v_short_code,
    'full_url', v_full_url
  );
END;
$$;
