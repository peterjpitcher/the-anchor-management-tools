-- Add settings columns to the sites table
-- These power the /settings General section

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS online_bookings_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_confirm_bookings BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_party_size INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS booking_duration_mins INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS advance_booking_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS min_group_size_deposit INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS reminder_hours_before INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS admin_email TEXT,
  ADD COLUMN IF NOT EXISTS cc_email TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Seed sensible defaults for the existing row
UPDATE sites SET
  phone = '+44 1372 377 945',
  email = 'info@the-anchor.pub',
  website = 'https://the-anchor.pub',
  address = 'The Anchor, 17 Church Street, Leatherhead, KT22 8DN'
WHERE phone IS NULL;
