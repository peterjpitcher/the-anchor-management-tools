-- Allow the requested 10% minimum and match the editor's existing 40% ceiling.
SET lock_timeout = '3s';
ALTER TABLE public.event_images
  DROP CONSTRAINT event_images_qr_width_frac_check,
  ADD CONSTRAINT event_images_qr_width_frac_check
    CHECK (qr_width_frac >= 0.1 AND qr_width_frac <= 0.4);
RESET lock_timeout;
