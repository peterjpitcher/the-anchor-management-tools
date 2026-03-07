-- Add refund tracking columns to payments table
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
