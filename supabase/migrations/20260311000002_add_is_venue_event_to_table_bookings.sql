ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS is_venue_event boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.table_bookings.is_venue_event IS
  'True when this booking is for a venue-hosted event. Automatically waives the deposit requirement regardless of party size or booking type.';
