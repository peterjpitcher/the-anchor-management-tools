INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES
  (
    'pacing_busy_threshold_covers',
    '{"value": 30}'::jsonb,
    'Table-booking smoothing: covers at or above this count are shown as busy.',
    NOW()
  ),
  (
    'pacing_filling_threshold_covers',
    '{"value": 20}'::jsonb,
    'Table-booking smoothing: covers at or above this count are shown as filling up.',
    NOW()
  ),
  (
    'pacing_window_minutes',
    '{"value": 60}'::jsonb,
    'Table-booking smoothing: rolling arrival window in minutes.',
    NOW()
  )
ON CONFLICT (key) DO NOTHING;
