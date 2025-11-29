-- This migration updates the schedule_config for Sunday (day_of_week = 0)
-- in the business_hours table to reflect a single, continuous Sunday Lunch service
-- from 12:00:00 to 17:00:00, removing the 'early' and 'late' distinctions.

BEGIN;

-- Update the schedule_config for Sunday (day_of_week = 0)
UPDATE public.business_hours
SET
  schedule_config = '[
    {
      "starts_at": "12:00:00",
      "ends_at": "17:00:00",
      "capacity": 50,
      "booking_type": "sunday_lunch",
      "slot_type": "sunday_lunch"
    }
  ]'::jsonb,
  -- Also update kitchen_opens and kitchen_closes for consistency, if they are not already set correctly
  kitchen_opens = '12:00:00',
  kitchen_closes = '17:00:00'
WHERE
  day_of_week = 0;

-- Optionally, you might want to remove the specific 'early' and 'late' entries
-- from service_slot_config if it's still being used for anything else,
-- or if this update marks a full transition away from service_slot_config for runtime.
-- For now, we assume schedule_config in business_hours is the source of truth for the app.
-- DELETE FROM public.service_slot_config
-- WHERE day_of_week = 0 AND slot_type IN ('sunday_lunch_early', 'sunday_lunch_late');

COMMIT;
