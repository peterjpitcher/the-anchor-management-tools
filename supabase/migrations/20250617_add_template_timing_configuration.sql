-- Add timing configuration to message templates

-- Add send_timing column to message_templates
ALTER TABLE message_templates 
ADD COLUMN send_timing TEXT CHECK (send_timing IN ('immediate', '1_hour', '12_hours', '24_hours', '7_days', 'custom'));

-- Add custom_timing_hours column for custom timing
ALTER TABLE message_templates 
ADD COLUMN custom_timing_hours INTEGER CHECK (custom_timing_hours > 0 AND custom_timing_hours <= 720); -- Max 30 days

-- Update existing templates with default timings
UPDATE message_templates 
SET send_timing = CASE 
  WHEN template_type IN ('booking_confirmation', 'booking_reminder_confirmation') THEN 'immediate'
  WHEN template_type IN ('reminder_24_hour', 'booking_reminder_24_hour') THEN '24_hours'
  WHEN template_type IN ('reminder_7_day', 'booking_reminder_7_day') THEN '7_days'
  ELSE 'immediate'
END
WHERE send_timing IS NULL;

-- Make send_timing NOT NULL after setting defaults
ALTER TABLE message_templates ALTER COLUMN send_timing SET NOT NULL;
ALTER TABLE message_templates ALTER COLUMN send_timing SET DEFAULT 'immediate';

-- Add the same columns to event_message_templates
ALTER TABLE event_message_templates 
ADD COLUMN send_timing TEXT CHECK (send_timing IN ('immediate', '1_hour', '12_hours', '24_hours', '7_days', 'custom'));

ALTER TABLE event_message_templates 
ADD COLUMN custom_timing_hours INTEGER CHECK (custom_timing_hours > 0 AND custom_timing_hours <= 720);

-- Set defaults for event templates
ALTER TABLE event_message_templates ALTER COLUMN send_timing SET DEFAULT 'immediate';

-- Add indexes for querying by timing
CREATE INDEX idx_message_templates_send_timing ON message_templates(send_timing);
CREATE INDEX idx_event_message_templates_send_timing ON event_message_templates(send_timing);

-- Create a function to calculate when a message should be sent
CREATE OR REPLACE FUNCTION calculate_send_time(
  p_event_timestamp TIMESTAMP WITH TIME ZONE,
  p_send_timing TEXT,
  p_custom_hours INTEGER DEFAULT NULL
)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  CASE p_send_timing
    WHEN 'immediate' THEN
      RETURN NOW();
    WHEN '1_hour' THEN
      RETURN p_event_timestamp - INTERVAL '1 hour';
    WHEN '12_hours' THEN
      RETURN p_event_timestamp - INTERVAL '12 hours';
    WHEN '24_hours' THEN
      RETURN p_event_timestamp - INTERVAL '24 hours';
    WHEN '7_days' THEN
      RETURN p_event_timestamp - INTERVAL '7 days';
    WHEN 'custom' THEN
      IF p_custom_hours IS NOT NULL THEN
        RETURN p_event_timestamp - (p_custom_hours || ' hours')::INTERVAL;
      ELSE
        RETURN p_event_timestamp; -- Fallback if custom hours not provided
      END IF;
    ELSE
      RETURN p_event_timestamp; -- Fallback for unknown timing
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Create a view to show templates with human-readable timing
CREATE OR REPLACE VIEW message_templates_with_timing AS
SELECT 
  mt.*,
  CASE 
    WHEN mt.send_timing = 'immediate' THEN 'Send immediately'
    WHEN mt.send_timing = '1_hour' THEN '1 hour before event'
    WHEN mt.send_timing = '12_hours' THEN '12 hours before event'
    WHEN mt.send_timing = '24_hours' THEN '24 hours before event'
    WHEN mt.send_timing = '7_days' THEN '7 days before event'
    WHEN mt.send_timing = 'custom' AND mt.custom_timing_hours IS NOT NULL THEN 
      mt.custom_timing_hours || ' hours before event'
    ELSE 'Unknown timing'
  END AS timing_description
FROM message_templates mt;

-- Update the get_message_template function to include timing
DROP FUNCTION IF EXISTS get_message_template(UUID, TEXT);

CREATE OR REPLACE FUNCTION get_message_template(
  p_event_id UUID,
  p_template_type TEXT
)
RETURNS TABLE (
  content TEXT,
  variables TEXT[],
  send_timing TEXT,
  custom_timing_hours INTEGER
) AS $$
BEGIN
  -- First check for event-specific template
  RETURN QUERY
  SELECT emt.content, emt.variables, emt.send_timing, emt.custom_timing_hours
  FROM event_message_templates emt
  WHERE emt.event_id = p_event_id
    AND emt.template_type = p_template_type
    AND emt.is_active = true
  LIMIT 1;
  
  -- If no event-specific template, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT mt.content, mt.variables, mt.send_timing, mt.custom_timing_hours
    FROM message_templates mt
    WHERE mt.template_type = p_template_type
      AND mt.is_default = true
      AND mt.is_active = true
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on the new view
GRANT SELECT ON message_templates_with_timing TO authenticated;

-- Comments
COMMENT ON COLUMN message_templates.send_timing IS 'When to send the message relative to the event time';
COMMENT ON COLUMN message_templates.custom_timing_hours IS 'Custom timing in hours before event (only used when send_timing = custom)';
COMMENT ON FUNCTION calculate_send_time IS 'Calculates when a message should be sent based on event time and timing configuration';