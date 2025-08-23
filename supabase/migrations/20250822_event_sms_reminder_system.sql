-- Migration: Enhanced Event SMS Reminder System
-- Description: Adds new reminder types and booking source tracking for improved SMS messaging

-- 1. Add new reminder types to the enum (if using enum)
-- First check if we're using an enum or just text
DO $$
BEGIN
  -- Check if reminder_type enum exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reminder_type') THEN
    -- Try to add new values to existing enum (wrapped in exception handler)
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_2_weeks';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_1_week';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_day_before';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'has_seats_1_week';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'has_seats_day_before';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- 2. Add booking_source to bookings table to track how booking was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'booking_source'
  ) THEN
    ALTER TABLE bookings 
    ADD COLUMN booking_source TEXT DEFAULT 'direct_booking'
    CHECK (booking_source IN ('direct_booking', 'bulk_add', 'customer_portal', 'sms_reply', 'import'));
  END IF;
END $$;

-- 3. Add last_reminder_sent to bookings table for tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'last_reminder_sent'
  ) THEN
    ALTER TABLE bookings 
    ADD COLUMN last_reminder_sent TIMESTAMPTZ;
  END IF;
END $$;

-- 4. Ensure booking_reminders table has proper structure
-- First add missing columns if the table already exists
DO $$
BEGIN
  -- Check if table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'booking_reminders'
  ) THEN
    -- Add scheduled_for column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'scheduled_for'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    
    -- Add status column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'status'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'));
    END IF;
    
    -- Add error_message column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'error_message'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN error_message TEXT;
    END IF;
    
    -- Add message_id column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'message_id'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN message_id TEXT;
    END IF;
    
    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS booking_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  message_id TEXT, -- Twilio message SID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_booking_reminders_scheduled 
ON booking_reminders(scheduled_for, status) 
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_booking_reminders_booking 
ON booking_reminders(booking_id, reminder_type);

CREATE INDEX IF NOT EXISTS idx_bookings_source 
ON bookings(booking_source);

CREATE INDEX IF NOT EXISTS idx_bookings_event_seats 
ON bookings(event_id, seats);

-- 6. Create or update the function to prevent duplicate reminders
CREATE OR REPLACE FUNCTION prevent_duplicate_reminders()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if a reminder of the same type already exists for this booking
  IF EXISTS (
    SELECT 1 FROM booking_reminders 
    WHERE booking_id = NEW.booking_id 
    AND reminder_type = NEW.reminder_type 
    AND status IN ('pending', 'sent')
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Duplicate reminder already exists for booking % with type %', 
      NEW.booking_id, NEW.reminder_type;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for duplicate prevention
DROP TRIGGER IF EXISTS prevent_duplicate_reminders_trigger ON booking_reminders;
CREATE TRIGGER prevent_duplicate_reminders_trigger
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_reminders();

-- 8. Add RLS policies for booking_reminders
ALTER TABLE booking_reminders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "Users can view reminders for accessible bookings" ON booking_reminders;
CREATE POLICY "Users can view reminders for accessible bookings" 
ON booking_reminders FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = booking_reminders.booking_id
  )
);

-- Only service role can insert/update/delete reminders
DROP POLICY IF EXISTS "Service role can manage reminders" ON booking_reminders;
CREATE POLICY "Service role can manage reminders" 
ON booking_reminders FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 9. Add helper function to calculate reminder dates
CREATE OR REPLACE FUNCTION calculate_reminder_dates(
  event_date DATE,
  event_time TEXT,
  has_seats BOOLEAN
)
RETURNS TABLE (
  reminder_type TEXT,
  scheduled_for TIMESTAMPTZ
) AS $$
DECLARE
  event_datetime TIMESTAMPTZ;
  days_until_event INTEGER;
BEGIN
  -- Combine date and time
  event_datetime := (event_date || ' ' || event_time)::TIMESTAMPTZ;
  days_until_event := (event_date - CURRENT_DATE);
  
  IF has_seats THEN
    -- Has seats: 1 week and 1 day before
    IF days_until_event >= 7 THEN
      RETURN QUERY SELECT 'has_seats_1_week'::TEXT, event_datetime - INTERVAL '7 days';
    END IF;
    IF days_until_event >= 1 THEN
      RETURN QUERY SELECT 'has_seats_day_before'::TEXT, event_datetime - INTERVAL '1 day';
    END IF;
  ELSE
    -- No seats: 2 weeks, 1 week, and 1 day before
    IF days_until_event >= 14 THEN
      RETURN QUERY SELECT 'no_seats_2_weeks'::TEXT, event_datetime - INTERVAL '14 days';
    END IF;
    IF days_until_event >= 7 THEN
      RETURN QUERY SELECT 'no_seats_1_week'::TEXT, event_datetime - INTERVAL '7 days';
    END IF;
    IF days_until_event >= 1 THEN
      RETURN QUERY SELECT 'no_seats_day_before'::TEXT, event_datetime - INTERVAL '1 day';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 10. Update existing bookings to have booking_source
UPDATE bookings 
SET booking_source = CASE 
  WHEN seats > 0 THEN 'direct_booking'
  ELSE 'bulk_add'
END
WHERE booking_source IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN bookings.booking_source IS 'Source of booking creation: direct_booking (New Booking button), bulk_add (Add Attendees), customer_portal, sms_reply, import';
COMMENT ON COLUMN bookings.last_reminder_sent IS 'Timestamp of the last reminder sent for this booking';
COMMENT ON TABLE booking_reminders IS 'Tracks scheduled and sent SMS reminders for event bookings';