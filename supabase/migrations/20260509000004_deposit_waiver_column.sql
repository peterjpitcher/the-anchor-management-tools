ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_waived BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.table_bookings.deposit_waived IS
  'True when a manager or super_admin explicitly waived the deposit at booking creation. Immutable after creation.';
