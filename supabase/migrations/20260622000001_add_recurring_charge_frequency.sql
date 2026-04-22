-- Add frequency column to recurring charges (default monthly for backwards compatibility)
ALTER TABLE public.oj_vendor_recurring_charges
  ADD COLUMN frequency text NOT NULL DEFAULT 'monthly'
  CONSTRAINT oj_vendor_recurring_charges_frequency_check
  CHECK (frequency IN ('monthly', 'quarterly', 'annually'));
