-- Repeating event details: the descriptive fields a normal event has, so a weekly night can carry its
-- own SEO copy, pictures, price and promotion copy. Approved by the owner on 27 November 2026
-- ("Yes to all six"). Bookings, tickets, texts and the checklist stay out by design: a repeating
-- event has none, and "Make this date a full event" covers a night that needs them.
--
-- Additive only: new nullable columns (arrays default to empty) and two CHECKs that the one live row
-- already passes. Nothing is dropped, renamed or rewritten. Image URLs are written by their own upload
-- actions, never by the form save, so a save cannot blank the artwork.
-- Rollback: ALTER TABLE public.event_series DROP CONSTRAINT event_series_price_positive,
--   DROP CONSTRAINT event_series_paid_has_price, then DROP COLUMN each column added below.

ALTER TABLE public.event_series
  ADD COLUMN brief text,
  ADD COLUMN performer_name text,
  ADD COLUMN performer_type text,
  ADD COLUMN price numeric(10, 2),
  ADD COLUMN meta_title text,
  ADD COLUMN meta_description text,
  ADD COLUMN long_description text,
  ADD COLUMN highlights text[] NOT NULL DEFAULT '{}',
  ADD COLUMN primary_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN secondary_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN local_seo_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN image_alt_text text,
  ADD COLUMN accessibility_notes text,
  ADD COLUMN facebook_event_name text,
  ADD COLUMN facebook_event_description text,
  ADD COLUMN gbp_event_title text,
  ADD COLUMN gbp_event_description text,
  ADD COLUMN social_copy_whatsapp text,
  ADD COLUMN square_image_url text,
  ADD COLUMN landscape_image_url text,
  ADD COLUMN social_image_url text,
  ADD COLUMN story_image_url text,
  ADD COLUMN print_poster_url text,
  ADD CONSTRAINT event_series_price_positive CHECK (price IS NULL OR price > 0),
  ADD CONSTRAINT event_series_paid_has_price CHECK (is_free OR price IS NOT NULL);

COMMENT ON COLUMN public.event_series.price IS 'Standard ticket price in pounds when the night is not free.';
COMMENT ON COLUMN public.event_series.square_image_url IS '1:1 poster. Written by the image upload action only.';
COMMENT ON COLUMN public.event_series.landscape_image_url IS '16:9 page hero. Written by the image upload action only.';
COMMENT ON COLUMN public.event_series.social_image_url IS '1.91:1 share image. Written by the image upload action only.';
