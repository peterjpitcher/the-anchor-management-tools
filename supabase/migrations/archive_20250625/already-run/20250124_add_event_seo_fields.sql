-- Add SEO and Schema.org compliant fields to events table
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS end_time TIME,
ADD COLUMN IF NOT EXISTS event_status VARCHAR(50) DEFAULT 'scheduled',
ADD COLUMN IF NOT EXISTS performer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS performer_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS price_currency VARCHAR(3) DEFAULT 'GBP',
ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS booking_url TEXT,
ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS recurrence_rule TEXT,
ADD COLUMN IF NOT EXISTS parent_event_id UUID REFERENCES events(id);

-- Create index for recurring events
CREATE INDEX IF NOT EXISTS idx_events_recurring ON events(is_recurring, parent_event_id);

-- Create menu tables for food/drink API
CREATE TABLE IF NOT EXISTS menu_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  price_currency VARCHAR(3) DEFAULT 'GBP',
  calories INTEGER,
  dietary_info JSONB DEFAULT '[]'::jsonb, -- vegetarian, vegan, gluten-free, etc.
  allergens JSONB DEFAULT '[]'::jsonb,
  is_available BOOLEAN DEFAULT true,
  is_special BOOLEAN DEFAULT false,
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create business hours table
CREATE TABLE IF NOT EXISTS business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 6=Saturday
  opens TIME,
  closes TIME,
  kitchen_opens TIME,
  kitchen_closes TIME,
  is_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(day_of_week)
);

-- Create special hours table for holidays/exceptions
CREATE TABLE IF NOT EXISTS special_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  opens TIME,
  closes TIME,
  kitchen_opens TIME,
  kitchen_closes TIME,
  is_closed BOOLEAN DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date)
);

-- Create business amenities table
CREATE TABLE IF NOT EXISTS business_amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL UNIQUE,
  available BOOLEAN DEFAULT true,
  details TEXT,
  capacity INTEGER,
  additional_info JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create API keys table for public API access
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '["read:events"]'::jsonb,
  rate_limit INTEGER DEFAULT 1000, -- requests per hour
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create API usage tracking table
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  events JSONB DEFAULT '["*"]'::jsonb, -- event types to send
  secret VARCHAR(255), -- for webhook signature verification
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create webhook logs table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempt_count INTEGER DEFAULT 1,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default business hours (example data)
INSERT INTO business_hours (day_of_week, opens, closes, kitchen_opens, kitchen_closes) VALUES
  (1, '16:00', '22:00', NULL, NULL), -- Monday
  (2, '16:00', '22:00', '18:00', '21:00'), -- Tuesday
  (3, '16:00', '22:00', '18:00', '21:00'), -- Wednesday
  (4, '16:00', '23:00', '18:00', '21:00'), -- Thursday
  (5, '16:00', '23:00', '18:00', '21:00'), -- Friday
  (6, '12:00', '23:00', '12:00', '21:00'), -- Saturday
  (0, '12:00', '22:00', '12:00', '20:00') -- Sunday
ON CONFLICT (day_of_week) DO NOTHING;

-- Insert default amenities
INSERT INTO business_amenities (type, available, details, capacity, additional_info) VALUES
  ('parking', true, 'Free parking for 50 cars', 50, '{"surface": "tarmac", "lighting": true}'::jsonb),
  ('wifi', true, 'Free WiFi - password at bar', NULL, '{"provider": "BT Business", "speed": "100Mbps"}'::jsonb),
  ('dogFriendly', true, 'Dogs welcome in bar area and garden', NULL, '{"water_bowls": true, "treats_available": true}'::jsonb),
  ('wheelchairAccess', true, 'Full wheelchair access throughout', NULL, '{"ramp": true, "accessible_toilet": true}'::jsonb),
  ('beerGarden', true, 'Large beer garden with covered areas', 100, '{"heatingAvailable": true, "covered_areas": true}'::jsonb),
  ('liveMusic', true, 'Live music every Friday and Saturday', NULL, '{"stage": true, "sound_system": true}'::jsonb),
  ('privateHire', true, 'Available for private functions', 150, '{"rooms": ["main_bar", "garden", "function_room"]}'::jsonb)
ON CONFLICT (type) DO NOTHING;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_menu_items_section ON menu_items(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_items_special ON menu_items(is_special, is_available);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_time ON api_usage(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_special_hours_date ON special_hours(date);
CREATE INDEX IF NOT EXISTS idx_events_date_status ON events(date, event_status);

-- Enable Row Level Security
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for public read access
CREATE POLICY "Public can read active menu sections" ON menu_sections
  FOR SELECT USING (is_active = true);

CREATE POLICY "Public can read available menu items" ON menu_items
  FOR SELECT USING (is_available = true);

CREATE POLICY "Public can read business hours" ON business_hours
  FOR SELECT USING (true);

CREATE POLICY "Public can read special hours" ON special_hours
  FOR SELECT USING (true);

CREATE POLICY "Public can read business amenities" ON business_amenities
  FOR SELECT USING (true);

-- API key policies (only system can manage)
CREATE POLICY "System can manage API keys" ON api_keys
  FOR ALL USING (auth.uid() IN (
    SELECT user_id FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE r.name = 'super_admin'
  ));

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_menu_sections_updated_at BEFORE UPDATE ON menu_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_business_hours_updated_at BEFORE UPDATE ON business_hours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_special_hours_updated_at BEFORE UPDATE ON special_hours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_business_amenities_updated_at BEFORE UPDATE ON business_amenities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();