-- Add explicit reminder flag to bookings so we no longer rely on seats === 0
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS is_reminder_only boolean NOT NULL DEFAULT false;

-- Backfill existing data: any booking without seats counts as a reminder
UPDATE public.bookings
SET is_reminder_only = COALESCE(seats, 0) = 0
WHERE is_reminder_only = false;

-- Helpful index for reminder-specific queries
CREATE INDEX IF NOT EXISTS idx_bookings_is_reminder_only
  ON public.bookings (is_reminder_only);
