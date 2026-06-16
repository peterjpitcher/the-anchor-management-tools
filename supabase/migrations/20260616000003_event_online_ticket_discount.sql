-- Add optional online ticket discounts for event bookings.
-- events.price remains the standard ticket price. Online PayPal/payment-link
-- orders use price minus this discount.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS online_discount_type text,
  ADD COLUMN IF NOT EXISTS online_discount_value numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_online_discount_type_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_online_discount_type_check
      CHECK (online_discount_type IS NULL OR online_discount_type IN ('fixed', 'percent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_online_discount_value_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_online_discount_value_check
      CHECK (
        (online_discount_type IS NULL AND online_discount_value IS NULL)
        OR (
          online_discount_type IN ('fixed', 'percent')
          AND
          online_discount_value IS NOT NULL
          AND
          online_discount_value >= 0
          AND (
            online_discount_type <> 'percent'
            OR online_discount_value <= 100
          )
        )
      );
  END IF;
END $$;
