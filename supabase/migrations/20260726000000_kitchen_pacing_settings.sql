-- Kitchen pacing: config settings (ship disabled) + per-date override columns.
-- Additive + idempotent; changes nothing until kitchen_pacing_enabled is true.

INSERT INTO public.system_settings (key, value, description)
VALUES
  ('kitchen_pacing_enabled',          '{"value": false}', 'Kitchen pacing: master on/off for the covers-per-window cap.'),
  ('kitchen_pacing_window_minutes',   '{"value": 30}',    'Kitchen pacing: rolling window length in minutes.'),
  ('kitchen_pace_covers_regular',     '{"value": 25}',    'Kitchen pacing: max food covers per window on a normal service.'),
  ('kitchen_pace_covers_sunday',      '{"value": 20}',    'Kitchen pacing: max food covers per window on a Sunday.'),
  ('kitchen_walk_in_reserve_regular', '{"value": 6}',     'Kitchen pacing: covers per window reserved for walk-ins (normal).'),
  ('kitchen_walk_in_reserve_sunday',  '{"value": 6}',     'Kitchen pacing: covers per window reserved for walk-ins (Sunday).')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.special_hours
  ADD COLUMN IF NOT EXISTS kitchen_pace_covers integer,
  ADD COLUMN IF NOT EXISTS kitchen_walk_in_reserve integer;
