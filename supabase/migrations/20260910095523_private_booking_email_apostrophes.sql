-- Keep existing accepted addresses and allow apostrophes and plus addressing,
-- which the application's email validator already accepts.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE public.private_bookings
  DROP CONSTRAINT chk_email_format,
  ADD CONSTRAINT chk_email_format CHECK (
    contact_email IS NULL
    OR contact_email ~* '^[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );
