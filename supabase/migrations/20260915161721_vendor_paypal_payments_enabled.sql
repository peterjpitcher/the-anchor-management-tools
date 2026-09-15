ALTER TABLE public.invoice_vendors
  ADD COLUMN paypal_payments_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoice_vendors.paypal_payments_enabled IS
  'Whether invoice emails and pages may offer card or PayPal payment for this vendor.';

UPDATE public.invoice_vendors
SET paypal_payments_enabled = true,
    updated_at = now()
WHERE id = 'ed3bb6b9-01a5-4894-b54f-b83fe73cc52b'::uuid
  AND name = 'Sidemen Entertainment Limited';
