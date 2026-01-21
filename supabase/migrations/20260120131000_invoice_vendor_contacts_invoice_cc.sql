-- Extend invoice vendor contacts with phone/role and invoice CC flag

ALTER TABLE public.invoice_vendor_contacts
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS receive_invoice_copy boolean NOT NULL DEFAULT false;

-- Index for quickly loading CC recipients
CREATE INDEX IF NOT EXISTS idx_invoice_vendor_contacts_receive_invoice_copy
ON public.invoice_vendor_contacts(vendor_id, receive_invoice_copy)
WHERE receive_invoice_copy = true;

