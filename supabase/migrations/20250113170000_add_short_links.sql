-- Create short links system for vip-club.uk
-- This allows us to create short, memorable URLs that redirect to various parts of the system

-- Create short_links table
CREATE TABLE IF NOT EXISTS short_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(20) UNIQUE NOT NULL,
  destination_url TEXT NOT NULL,
  link_type VARCHAR(50) NOT NULL CHECK (link_type IN ('loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom')),
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  click_count INTEGER DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_short_links_short_code ON short_links(short_code);
CREATE INDEX IF NOT EXISTS idx_short_links_link_type ON short_links(link_type);
CREATE INDEX IF NOT EXISTS idx_short_links_expires_at ON short_links(expires_at) WHERE expires_at IS NOT NULL;

-- Create click tracking table
CREATE TABLE IF NOT EXISTS short_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_link_id UUID REFERENCES short_links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  user_agent TEXT,
  ip_address INET,
  referrer TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Create index for analytics
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_short_link_id ON short_link_clicks(short_link_id);
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_clicked_at ON short_link_clicks(clicked_at);

-- Function to generate unique short codes
CREATE OR REPLACE FUNCTION generate_short_code(length INTEGER DEFAULT 6)
RETURNS VARCHAR AS $$
DECLARE
  chars VARCHAR := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result VARCHAR := '';
  i INTEGER;
BEGIN
  -- Generate random string
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to create a short link with automatic code generation
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
      
      -- Check if code already exists
      IF NOT EXISTS (SELECT 1 FROM short_links WHERE short_code = v_short_code) THEN
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
  
  -- Return the short code and full URL
  RETURN QUERY SELECT 
    v_short_code,
    'https://vip-club.uk/' || v_short_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policies
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_link_clicks ENABLE ROW LEVEL SECURITY;

-- Staff can view all short links
CREATE POLICY "Staff can view short links" ON short_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
    )
  );

-- Staff can create short links
CREATE POLICY "Staff can create short links" ON short_links
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
    )
  );

-- Staff can update their own short links
CREATE POLICY "Staff can update own short links" ON short_links
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Anyone can view click analytics (but only for existing short links)
CREATE POLICY "View click analytics" ON short_link_clicks
  FOR SELECT
  USING (true);

-- System can insert click tracking
CREATE POLICY "System can track clicks" ON short_link_clicks
  FOR INSERT
  WITH CHECK (true);