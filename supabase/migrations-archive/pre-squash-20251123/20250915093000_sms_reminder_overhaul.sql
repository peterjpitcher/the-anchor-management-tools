-- SMS reminder overhaul: align schema with new scheduling pipeline

-- 1. Expand reminder_type constraint to include new cadence types while keeping legacy values
ALTER TABLE booking_reminders
  DROP CONSTRAINT IF EXISTS booking_reminders_reminder_type_check;

ALTER TABLE booking_reminders
  ADD CONSTRAINT booking_reminders_reminder_type_check
  CHECK (
    reminder_type IN (
      'booking_confirmation',
      'booked_1_month',
      'booked_1_week',
      'booked_1_day',
      'reminder_invite_1_month',
      'reminder_invite_1_week',
      'reminder_invite_1_day',
      'no_seats_2_weeks',
      'no_seats_1_week',
      'no_seats_day_before',
      'has_seats_1_week',
      'has_seats_day_before',
      'booking_reminder_24_hour',
      'booking_reminder_7_day',
      -- legacy values retained for historical rows
      '24_hour',
      '7_day',
      '12_hour',
      '1_hour',
      'custom'
    )
  );

-- 2. Ensure event_id and target_phone columns exist for deduping per guest
ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS event_id UUID;

ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS target_phone TEXT;

-- 3. Backfill event_id and target_phone using current booking/customer data
WITH booking_data AS (
  SELECT br.id,
         b.event_id,
         c.mobile_number
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN customers c ON c.id = b.customer_id
)
UPDATE booking_reminders br
SET event_id = COALESCE(br.event_id, booking_data.event_id),
    target_phone = COALESCE(br.target_phone, booking_data.mobile_number)
FROM booking_data
WHERE br.id = booking_data.id
  AND (br.event_id IS NULL OR br.target_phone IS NULL);

-- 4. Normalise target_phone format by trimming whitespace
UPDATE booking_reminders
SET target_phone = NULLIF(trim(target_phone), '')
WHERE target_phone IS NOT NULL;

-- 5. Create partial unique index to prevent duplicated sends per event/phone/type
DROP INDEX IF EXISTS idx_booking_reminders_phone_unique;
CREATE UNIQUE INDEX idx_booking_reminders_phone_unique
  ON booking_reminders(event_id, target_phone, reminder_type)
  WHERE status IN ('pending', 'sent') AND target_phone IS NOT NULL;

-- 6. Refresh trigger to enforce uniqueness and backfill missing metadata automatically
CREATE OR REPLACE FUNCTION prevent_duplicate_reminders()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id UUID;
  v_phone TEXT;
BEGIN
  -- Resolve event id and phone if not supplied
  IF NEW.event_id IS NULL OR NEW.target_phone IS NULL THEN
    SELECT b.event_id, c.mobile_number
    INTO v_event_id, v_phone
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.id = NEW.booking_id;

    IF NEW.event_id IS NULL THEN
      NEW.event_id := v_event_id;
    END IF;
    IF NEW.target_phone IS NULL THEN
      NEW.target_phone := v_phone;
    END IF;
  END IF;

  -- Prevent duplicates for the same guest/event/type when reminder is still active
  IF EXISTS (
    SELECT 1
    FROM booking_reminders br
    WHERE br.id <> NEW.id
      AND br.event_id = NEW.event_id
      AND br.reminder_type = NEW.reminder_type
      AND br.target_phone = NEW.target_phone
      AND br.status IN ('pending', 'sent')
  ) THEN
    RAISE EXCEPTION 'Duplicate reminder already exists for event %, phone %, type %',
      NEW.event_id, NEW.target_phone, NEW.reminder_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_duplicate_reminders_trigger ON booking_reminders;
CREATE TRIGGER prevent_duplicate_reminders_trigger
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_reminders();

-- 7. Touch updated_at when metadata changes
ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION booking_reminders_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_reminders_set_updated_at_trigger ON booking_reminders;
CREATE TRIGGER booking_reminders_set_updated_at_trigger
  BEFORE UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION booking_reminders_set_updated_at();
