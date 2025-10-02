ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS contact_name text;

COMMENT ON COLUMN public.vendors.contact_name IS 'Primary contact person for private bookings.';
