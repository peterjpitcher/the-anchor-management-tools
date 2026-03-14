-- Add PayPal tracking columns to private_bookings
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS paypal_deposit_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paypal_deposit_capture_id TEXT;

-- Index for webhook lookups
CREATE INDEX IF NOT EXISTS idx_private_bookings_paypal_order_id
  ON public.private_bookings (paypal_deposit_order_id)
  WHERE paypal_deposit_order_id IS NOT NULL;
