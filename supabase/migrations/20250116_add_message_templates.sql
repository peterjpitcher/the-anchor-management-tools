-- Create message templates system for dynamic SMS content

-- Create message templates table
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  template_type TEXT NOT NULL CHECK (template_type IN ('booking_confirmation', 'reminder_7_day', 'reminder_24_hour', 'custom')),
  content TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}', -- Array of available variables
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  character_count INTEGER GENERATED ALWAYS AS (LENGTH(content)) STORED,
  estimated_segments INTEGER GENERATED ALWAYS AS (
    CASE 
      WHEN LENGTH(content) <= 160 THEN 1
      ELSE CEIL(LENGTH(content)::NUMERIC / 153)
    END
  ) STORED
);

-- Create event-specific template overrides
CREATE TABLE IF NOT EXISTS event_message_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('booking_confirmation', 'reminder_7_day', 'reminder_24_hour', 'custom')),
  content TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  character_count INTEGER GENERATED ALWAYS AS (LENGTH(content)) STORED,
  estimated_segments INTEGER GENERATED ALWAYS AS (
    CASE 
      WHEN LENGTH(content) <= 160 THEN 1
      ELSE CEIL(LENGTH(content)::NUMERIC / 153)
    END
  ) STORED,
  UNIQUE(event_id, template_type)
);

-- Create template history for versioning
CREATE TABLE IF NOT EXISTS message_template_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES message_templates(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  content TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  change_reason TEXT
);

-- Insert default templates
INSERT INTO message_templates (name, template_type, content, variables, is_default, is_active) VALUES
(
  'Default Booking Confirmation',
  'booking_confirmation',
  'Hi {{customer_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} is confirmed! {{seats}} seats reserved. Reply to this message if you need to make any changes. The Anchor Team',
  ARRAY['customer_name', 'event_name', 'event_date', 'event_time', 'seats'],
  true,
  true
),
(
  'Default 7-Day Reminder',
  'reminder_7_day',
  'Hi {{customer_name}}, just a reminder that you have {{seats}} seats booked for {{event_name}} on {{event_date}} at {{event_time}}. We look forward to seeing you! Reply if you need to make changes. The Anchor Team',
  ARRAY['customer_name', 'seats', 'event_name', 'event_date', 'event_time'],
  true,
  true
),
(
  'Default 24-Hour Reminder',
  'reminder_24_hour',
  'Hi {{customer_name}}, see you tomorrow! You have {{seats}} seats for {{event_name}} at {{event_time}}. If you can no longer attend, please let us know. The Anchor Team',
  ARRAY['customer_name', 'seats', 'event_name', 'event_time'],
  true,
  true
);

-- Create indexes
CREATE INDEX idx_message_templates_type ON message_templates(template_type);
CREATE INDEX idx_message_templates_default ON message_templates(is_default);
CREATE INDEX idx_event_message_templates_event ON event_message_templates(event_id);

-- Function to get the appropriate template for an event
CREATE OR REPLACE FUNCTION get_message_template(
  p_event_id UUID,
  p_template_type TEXT
)
RETURNS TABLE (
  content TEXT,
  variables TEXT[]
) AS $$
BEGIN
  -- First check for event-specific template
  RETURN QUERY
  SELECT emt.content, emt.variables
  FROM event_message_templates emt
  WHERE emt.event_id = p_event_id
    AND emt.template_type = p_template_type
    AND emt.is_active = true
  LIMIT 1;
  
  -- If no event-specific template, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT mt.content, mt.variables
    FROM message_templates mt
    WHERE mt.template_type = p_template_type
      AND mt.is_default = true
      AND mt.is_active = true
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to render a template with variables
CREATE OR REPLACE FUNCTION render_template(
  p_template TEXT,
  p_variables JSONB
)
RETURNS TEXT AS $$
DECLARE
  v_result TEXT := p_template;
  v_key TEXT;
  v_value TEXT;
BEGIN
  -- Replace each variable in the template
  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_variables)
  LOOP
    v_result := REPLACE(v_result, '{{' || v_key || '}}', COALESCE(v_value, ''));
  END LOOP;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Update function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_message_templates_updated_at 
BEFORE UPDATE ON message_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to log template changes
CREATE OR REPLACE FUNCTION log_template_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    INSERT INTO message_template_history (template_id, content, changed_by)
    VALUES (NEW.id, OLD.content, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_template_changes
AFTER UPDATE ON message_templates
FOR EACH ROW EXECUTE FUNCTION log_template_change();

-- Grant permissions
GRANT SELECT ON message_templates TO authenticated;
GRANT SELECT ON event_message_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON message_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_message_templates TO authenticated;
GRANT SELECT ON message_template_history TO authenticated;

-- Row Level Security
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_template_history ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view all templates" ON message_templates
  FOR SELECT USING (true);

CREATE POLICY "Users can manage templates" ON message_templates
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view event templates" ON event_message_templates
  FOR SELECT USING (true);

CREATE POLICY "Users can manage event templates" ON event_message_templates
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view template history" ON message_template_history
  FOR SELECT USING (true);

-- Comments
COMMENT ON TABLE message_templates IS 'System-wide message templates for SMS communications';
COMMENT ON TABLE event_message_templates IS 'Event-specific overrides for message templates';
COMMENT ON TABLE message_template_history IS 'Version history for message templates';