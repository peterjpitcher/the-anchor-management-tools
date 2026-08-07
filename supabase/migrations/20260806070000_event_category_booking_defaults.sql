ALTER TABLE public.event_categories
  ADD COLUMN IF NOT EXISTS default_booking_mode text NOT NULL DEFAULT 'table',
  ADD COLUMN IF NOT EXISTS default_payment_mode text NOT NULL DEFAULT 'free';

ALTER TABLE public.event_categories
  DROP CONSTRAINT IF EXISTS event_categories_default_booking_mode_check,
  DROP CONSTRAINT IF EXISTS event_categories_default_payment_mode_check;

ALTER TABLE public.event_categories
  ADD CONSTRAINT event_categories_default_booking_mode_check
    CHECK (default_booking_mode IN ('table', 'general', 'mixed', 'communal')),
  ADD CONSTRAINT event_categories_default_payment_mode_check
    CHECK (default_payment_mode IN ('free', 'cash_only', 'prepaid'));

UPDATE public.event_categories
SET default_payment_mode = CASE
  WHEN COALESCE(default_is_free, false) THEN 'free'
  WHEN COALESCE(default_price, 0) > 0 THEN 'cash_only'
  ELSE 'free'
END;

COMMENT ON COLUMN public.event_categories.default_booking_mode IS
  'Booking layout copied to new events: table, general, mixed, or communal.';

COMMENT ON COLUMN public.event_categories.default_payment_mode IS
  'Payment method copied to new events: free, cash_only, or prepaid.';
