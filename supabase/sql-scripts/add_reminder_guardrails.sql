-- Add guardrails to prevent early/duplicate D-1 sends and normalize legacy types
-- Safe to run multiple times

-- 1) Drop narrow CHECK constraint if present (to allow new taxonomy)
ALTER TABLE IF EXISTS booking_reminders
  DROP CONSTRAINT IF EXISTS booking_reminders_reminder_type_check;

-- 2) Ensure unique constraint on (booking_id, reminder_type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_booking_reminder'
  ) THEN
    ALTER TABLE booking_reminders
      ADD CONSTRAINT unique_booking_reminder UNIQUE (booking_id, reminder_type);
  END IF;
END $$;

-- 3) Trigger function to normalize reminder types and enforce timing
CREATE OR REPLACE FUNCTION normalize_and_enforce_booking_reminders()
RETURNS TRIGGER AS $$
DECLARE
  v_seats integer;
  v_event_date date;
  v_min_date date;
BEGIN
  -- Lookup booking + event data
  SELECT b.seats, e.date
    INTO v_seats, v_event_date
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE b.id = NEW.booking_id;

  IF v_event_date IS NULL THEN
    RETURN NEW; -- can't enforce without context
  END IF;

  -- Map legacy reminder types to canonical ones
  IF NEW.reminder_type = '24_hour' THEN
    IF COALESCE(v_seats, 0) > 0 THEN
      NEW.reminder_type := 'has_seats_day_before';
    ELSE
      NEW.reminder_type := 'no_seats_day_before';
    END IF;
  ELSIF NEW.reminder_type = '7_day' THEN
    IF COALESCE(v_seats, 0) > 0 THEN
      NEW.reminder_type := 'has_seats_1_week';
    ELSE
      NEW.reminder_type := 'no_seats_1_week';
    END IF;
  END IF;

  -- If a day-before type is used for seats=0 but marked as has_seats, flip it
  IF NEW.reminder_type = 'has_seats_day_before' AND COALESCE(v_seats, 0) = 0 THEN
    NEW.reminder_type := 'no_seats_day_before';
  END IF;

  -- Enforce minimum scheduled_for per type (clamp forward if earlier)
  IF NEW.reminder_type IN ('has_seats_day_before', 'no_seats_day_before') THEN
    v_min_date := (v_event_date - INTERVAL '1 day')::date;
  ELSIF NEW.reminder_type IN ('has_seats_1_week', 'no_seats_1_week') THEN
    v_min_date := (v_event_date - INTERVAL '7 days')::date;
  ELSIF NEW.reminder_type = 'no_seats_2_weeks' THEN
    v_min_date := (v_event_date - INTERVAL '14 days')::date;
  ELSE
    v_min_date := NULL; -- other types not enforced here
  END IF;

  IF v_min_date IS NOT NULL AND NEW.scheduled_for::date < v_min_date THEN
    NEW.scheduled_for := (v_min_date::timestamp with time zone)
                          + make_interval(hours := 10); -- default 10:00 local
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Create trigger
DROP TRIGGER IF EXISTS trg_normalize_and_enforce_booking_reminders ON booking_reminders;
CREATE TRIGGER trg_normalize_and_enforce_booking_reminders
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION normalize_and_enforce_booking_reminders();

