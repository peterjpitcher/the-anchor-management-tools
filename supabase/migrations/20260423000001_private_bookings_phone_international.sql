-- Expand private booking contact phone constraint to support international formats.
-- Keep transitional local/legacy numeric formats to avoid breaking existing records.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_phone_format'
      AND conrelid = 'public.private_bookings'::regclass
  ) THEN
    ALTER TABLE public.private_bookings DROP CONSTRAINT chk_phone_format;
  END IF;

  ALTER TABLE public.private_bookings
    ADD CONSTRAINT chk_phone_format CHECK (
      contact_phone IS NULL
      OR contact_phone ~ '^\+[1-9][0-9]{7,14}$'
      OR contact_phone ~ '^00[1-9][0-9]{7,14}$'
      OR contact_phone ~ '^0[0-9]{6,14}$'
      OR contact_phone ~ '^[1-9][0-9]{7,14}$'
    );
END
$$;

