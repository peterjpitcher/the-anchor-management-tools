-- Migration: Redesign Business Hours
-- Description: Adds schedule_config to business_hours and special_hours, and migrates existing slot configs.

-- 1. Add schedule_config column to business_hours
ALTER TABLE business_hours 
ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '[]'::JSONB;

-- 2. Add schedule_config column to special_hours
ALTER TABLE special_hours 
ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '[]'::JSONB;

-- 3. Data Migration: Move service_slot_config data to business_hours
-- We aggregate the active configs for each day into the JSON structure
WITH configs AS (
  SELECT 
    day_of_week,
    jsonb_agg(jsonb_build_object(
      'name', slot_type,
      'starts_at', to_char(starts_at, 'HH24:MI'),
      'ends_at', to_char(ends_at, 'HH24:MI'),
      'capacity', capacity,
      'booking_type', booking_type
    ) ORDER BY starts_at) as config
  FROM service_slot_config
  WHERE is_active = true
  GROUP BY day_of_week
)
UPDATE business_hours bh
SET schedule_config = c.config
FROM configs c
WHERE bh.day_of_week = c.day_of_week;

-- 4. Ensure special_hours also has a default structure (optional, strictly it can be null or empty to imply "Closed" or "Use Default"?)
-- For now, we leave it empty. The logic will be: if special_hours exists, use its config. If its config is empty array, it means closed? 
-- No, special_hours has `is_closed`. If `is_closed` is false, we expect a schedule.
-- We don't have easy data to migrate for special_hours, so we leave them as is. 
-- Future special hours will need to include the config.

-- 5. Grant permissions (standard practice)
GRANT ALL ON TABLE business_hours TO service_role;
GRANT ALL ON TABLE special_hours TO service_role;
