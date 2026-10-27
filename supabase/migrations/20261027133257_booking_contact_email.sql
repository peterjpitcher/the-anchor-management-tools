-- Keep the email a guest typed for one table or event booking (BK-078, customer bookings review
-- of 24 October 2026).
--
-- Bookings are matched to a customer by phone. When the number belongs to a customer with a
-- different address, or the typed address is already on another customer's record, the typed
-- address was thrown away and the booking's confirmation, payment link and reminders went to the
-- old address or by text. Private bookings already keep their own contact details; table and
-- event bookings now keep the typed email, and only that: the phone always matches the customer
-- the booking is filed under, and no message reads a typed name.
--
-- The app writes it only when the customer record does not already hold the typed address, so it
-- is a second copy of personal data only where it differs. Erasure and data requests cover it
-- (src/services/gdpr.ts).
--
-- Adding a nullable column with no default is a catalogue-only change: no table rewrite, no long
-- lock. No view selects these tables with *, so no view needs rebuilding. Grants are unchanged:
-- anon holds SELECT on table_bookings, but RLS on table_bookings has no policy for anon, so it
-- reads no rows; bookings has no anon grant.
--
-- Rollback: tasks/booking-contact-email/rollback.sql

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS contact_email text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS contact_email text;

-- Stored lower-cased and trimmed by the app. The check keeps junk out without trying to be a
-- full address validator: the app validates the address before it gets here.
ALTER TABLE public.table_bookings
  ADD CONSTRAINT table_bookings_contact_email_shape
  CHECK (contact_email IS NULL OR (char_length(contact_email) BETWEEN 3 AND 320 AND contact_email = lower(btrim(contact_email)) AND position('@' IN contact_email) > 1));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_contact_email_shape
  CHECK (contact_email IS NULL OR (char_length(contact_email) BETWEEN 3 AND 320 AND contact_email = lower(btrim(contact_email)) AND position('@' IN contact_email) > 1));

COMMENT ON COLUMN public.table_bookings.contact_email IS
  'Email the guest typed for this booking when the customer record does not hold it. Booking messages prefer it over customers.email. Personal data: cleared by GDPR erasure.';

COMMENT ON COLUMN public.bookings.contact_email IS
  'Email the guest typed for this booking when the customer record does not hold it. Booking messages prefer it over customers.email. Personal data: cleared by GDPR erasure.';
