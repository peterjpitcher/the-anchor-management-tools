-- Enforce normalized event time format (HH:mm or HH:mm:ss)
-- Safe pattern check + conditional constraint creation

-- 1) Show offending rows (if any)
SELECT id, name, date, time
FROM events
WHERE time IS NULL OR time !~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$'
ORDER BY date
LIMIT 50;

-- 2) Add CHECK constraint only if no offending rows exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM events WHERE time IS NULL OR time !~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$'
  ) THEN
    BEGIN
      ALTER TABLE events
        ADD CONSTRAINT chk_events_time_format
        CHECK (time ~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$');
    EXCEPTION WHEN duplicate_object THEN
      -- Constraint already exists
      NULL;
    END;
  ELSE
    RAISE NOTICE 'Cannot add time format CHECK: offending rows exist. Fix rows listed above and rerun.';
  END IF;
END $$;

