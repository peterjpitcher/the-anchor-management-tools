-- Fix permissions and ambiguous column reference in short links

-- First, fix the ambiguous column reference in the function
CREATE OR REPLACE FUNCTION create_short_link(
  p_destination_url TEXT,
  p_link_type VARCHAR,
  p_metadata JSONB DEFAULT '{}',
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_custom_code VARCHAR DEFAULT NULL
)
RETURNS TABLE(short_code VARCHAR, full_url TEXT) AS $$
DECLARE
  v_short_code VARCHAR;
  v_attempts INTEGER := 0;
  v_max_attempts INTEGER := 10;
BEGIN
  -- Use custom code if provided
  IF p_custom_code IS NOT NULL THEN
    v_short_code := p_custom_code;
  ELSE
    -- Generate unique short code
    LOOP
      v_short_code := generate_short_code(6);
      
      -- Check if code already exists (use full table reference to avoid ambiguity)
      IF NOT EXISTS (SELECT 1 FROM short_links sl WHERE sl.short_code = v_short_code) THEN
        EXIT;
      END IF;
      
      v_attempts := v_attempts + 1;
      IF v_attempts >= v_max_attempts THEN
        RAISE EXCEPTION 'Could not generate unique short code after % attempts', v_max_attempts;
      END IF;
    END LOOP;
  END IF;
  
  -- Insert the short link
  INSERT INTO short_links (
    short_code,
    destination_url,
    link_type,
    metadata,
    expires_at,
    created_by
  ) VALUES (
    v_short_code,
    p_destination_url,
    p_link_type,
    p_metadata,
    p_expires_at,
    auth.uid()
  );
  
  -- Return the short code and full URL (use explicit column names)
  RETURN QUERY SELECT 
    v_short_code AS short_code,
    'https://vip-club.uk/' || v_short_code AS full_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add more permissive RLS policies for short_links
DROP POLICY IF EXISTS "Staff can view short links" ON short_links;
DROP POLICY IF EXISTS "Staff can create short links" ON short_links;
DROP POLICY IF EXISTS "Staff can update own short links" ON short_links;

-- Allow any authenticated user to view short links
CREATE POLICY "Authenticated users can view short links" ON short_links
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Allow any authenticated user to create short links
CREATE POLICY "Authenticated users can create short links" ON short_links
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow users to update their own short links
CREATE POLICY "Users can update own short links" ON short_links
  FOR UPDATE
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

-- Allow users to delete their own short links
CREATE POLICY "Users can delete own short links" ON short_links
  FOR DELETE
  USING (created_by = auth.uid() OR created_by IS NULL);

-- Also ensure clicks can be inserted by anyone
DROP POLICY IF EXISTS "System can track clicks" ON short_link_clicks;
CREATE POLICY "Anyone can track clicks" ON short_link_clicks
  FOR INSERT
  WITH CHECK (true);

-- Allow viewing clicks for authenticated users
CREATE POLICY "Authenticated users can view clicks" ON short_link_clicks
  FOR SELECT
  USING (auth.uid() IS NOT NULL);