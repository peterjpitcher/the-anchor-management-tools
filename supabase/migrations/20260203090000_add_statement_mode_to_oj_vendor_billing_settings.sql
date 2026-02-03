ALTER TABLE public.oj_vendor_billing_settings
  ADD COLUMN IF NOT EXISTS statement_mode boolean NOT NULL DEFAULT false;
