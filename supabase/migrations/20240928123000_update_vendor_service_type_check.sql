ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_service_type_check;
ALTER TABLE public.vendors ADD CONSTRAINT vendors_service_type_check CHECK (
  service_type = ANY (ARRAY['dj','band','photographer','florist','decorator','cake','entertainment','transport','equipment','other'])
);
