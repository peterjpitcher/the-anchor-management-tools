-- Rollback for supabase/migrations/20261027133257_booking_contact_email.sql.
-- Restores production as it was before: neither table had a contact_email column.
-- Any email kept on a booking is lost, and that booking's messages go back to the customer's
-- own address. Roll the app code back first, or its writes to the column fail.

ALTER TABLE public.table_bookings DROP CONSTRAINT IF EXISTS table_bookings_contact_email_shape;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_contact_email_shape;
ALTER TABLE public.table_bookings DROP COLUMN IF EXISTS contact_email;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS contact_email;
