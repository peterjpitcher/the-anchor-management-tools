-- Saturday's "dinner" slot ran 17:00-21:00 but the Saturday kitchen closes at
-- 19:00, so the published window advertised two hours of dinner service the
-- kitchen does not work. Food bookings were already clamped to 19:00 by the
-- kitchen check in create_table_booking_v05, so nothing was over-booked, but the
-- advertised window was wrong. Owner confirmed on 8 August 2026 that the
-- Saturday kitchen hours are correct, so the slot is shortened to match.
--
-- The slot's booking_type is 'regular', which gates drinks bookings as well as
-- food, so validate_schedule_config() accepts either value. This is a
-- correctness fix to what the venue advertises, not something the guard forced.

BEGIN;

UPDATE public.business_hours
SET schedule_config = (
      SELECT COALESCE(jsonb_agg(
               CASE
                 WHEN LOWER(TRIM(COALESCE(slot ->> 'name', ''))) = 'dinner'
                  AND slot ->> 'starts_at' = '17:00'
                  AND slot ->> 'ends_at' = '21:00'
                 THEN jsonb_set(slot, '{ends_at}', '"19:00"'::jsonb)
                 ELSE slot
               END
               ORDER BY ord
             ), '[]'::jsonb)
      FROM jsonb_array_elements(schedule_config) WITH ORDINALITY AS t(slot, ord)
    ),
    updated_at = now()
WHERE day_of_week = 6
  AND jsonb_typeof(schedule_config) = 'array';

COMMIT;
