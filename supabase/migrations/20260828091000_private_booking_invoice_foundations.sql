-- Phase 1: database foundations for invoicing a private booking.
--
-- Additive only. No behaviour changes on its own. Everything here exists to
-- make the phase 2 atomic function safe.
--
-- Five problems this fixes, all found in review:
--   1. Nothing links a booking to its invoice, and nothing stops two clicks
--      creating two invoices.
--   2. invoice_payments has no source identity, so a retry double-counts.
--   3. invoice_line_items has no ordering column, so PDF line order is not
--      stable between generating, retrying and downloading.
--   4. invoice_vendors has exactly one constraint (its PK), so "upsert by
--      email" is impossible: email is neither unique nor case-normalised.
--   5. invoices.status carries BOTH delivery state and payment state in one
--      mutually exclusive CHECK. An invoice born 'paid' cannot also be 'sent'.

-- ---------------------------------------------------------------------------
-- 1. Link the booking to its invoice
-- ---------------------------------------------------------------------------

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS invoice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_deposit_treatment text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'private_bookings_invoice_deposit_treatment_check'
  ) THEN
    ALTER TABLE public.private_bookings
      ADD CONSTRAINT private_bookings_invoice_deposit_treatment_check
      CHECK (invoice_deposit_treatment IN ('held_separately', 'deducted'));
  END IF;
END $$;

-- Backstop only. The real double-click guard is the FOR UPDATE lock plus the
-- conditional UPDATE inside create_private_booking_invoice_atomic. This index
-- catches one invoice being attached to two bookings, which the lock cannot.
CREATE UNIQUE INDEX IF NOT EXISTS private_bookings_invoice_id_key
  ON public.private_bookings (invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN public.private_bookings.invoice_id IS
  'The invoice raised for this booking, if any. One invoice per booking.';
COMMENT ON COLUMN public.private_bookings.invoice_sent_at IS
  'When the invoice email was successfully sent. Mirrors invoices.sent_at for the booking screen.';
COMMENT ON COLUMN public.private_bookings.invoice_deposit_treatment IS
  'How the deposit was treated on the invoice. held_separately = refundable, not deducted (contract default). deducted = applied to the invoice as a payment, for account customers billed rather than paying upfront.';

-- ---------------------------------------------------------------------------
-- 2. Idempotent payment copy
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS source_payment_id uuid
    REFERENCES public.private_booking_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_source_kind_check'
  ) THEN
    ALTER TABLE public.invoice_payments
      ADD CONSTRAINT invoice_payments_source_kind_check
      CHECK (source_kind IN ('booking_payment', 'booking_deposit'));
  END IF;
END $$;

-- Scoped to (invoice_id, source_payment_id), not source_payment_id alone: a
-- booking payment could legitimately appear on a replacement invoice later.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_invoice_source_key
  ON public.invoice_payments (invoice_id, source_payment_id)
  WHERE source_payment_id IS NOT NULL;

-- The deposit has no row in private_booking_payments to point at, so it needs
-- its own guard. At most one deposit payment per invoice.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_invoice_deposit_key
  ON public.invoice_payments (invoice_id)
  WHERE source_kind = 'booking_deposit';

COMMENT ON COLUMN public.invoice_payments.source_payment_id IS
  'The private_booking_payments row this was copied from. Makes the copy idempotent on retry.';
COMMENT ON COLUMN public.invoice_payments.source_kind IS
  'booking_payment = copied from private_booking_payments. booking_deposit = the booking deposit applied to this invoice.';

-- ---------------------------------------------------------------------------
-- 3. Stable line ordering
-- ---------------------------------------------------------------------------
--
-- The 113 existing rows all get 0 and share a created_at, so no backfill can
-- recover their original order: it was never deterministic. Every query that
-- reads invoice_line_items must now add an explicit ORDER BY.

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_order
  ON public.invoice_line_items (invoice_id, display_order);

COMMENT ON COLUMN public.invoice_line_items.display_order IS
  'Render order. Existing rows are all 0; order was never deterministic before this column.';

-- ---------------------------------------------------------------------------
-- 4. Vendor identity
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoice_vendors
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);

-- The ONLY safe upsert key. Do not match vendors on name or email.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_vendors_customer_id_key
  ON public.invoice_vendors (customer_id)
  WHERE customer_id IS NOT NULL;

-- Supports a case-insensitive lookup for staff-facing duplicate warnings.
-- NOT an upsert key: email is not unique and several vendors share none.
CREATE INDEX IF NOT EXISTS idx_invoice_vendors_email_lower
  ON public.invoice_vendors (lower(btrim(email)))
  WHERE email IS NOT NULL;

COMMENT ON COLUMN public.invoice_vendors.customer_id IS
  'Links this billing party to a customer record. The only safe key for finding an existing vendor.';

-- ---------------------------------------------------------------------------
-- 5. Separate delivery state from payment state
-- ---------------------------------------------------------------------------
--
-- invoices.status stays exactly as it is, a compatibility mirror, so every
-- existing Orange Jelly path keeps working untouched. From here on:
--   delivered  = sent_at IS NOT NULL   (never status = 'sent')
--   payment    = payment_state         (never status)

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices'
      AND column_name = 'payment_state'
  ) THEN
    ALTER TABLE public.invoices
      ADD COLUMN payment_state text
      GENERATED ALWAYS AS (
        CASE
          WHEN total_amount > 0 AND paid_amount >= total_amount THEN 'paid'
          WHEN paid_amount > 0 THEN 'part_paid'
          ELSE 'unpaid'
        END
      ) STORED;
  END IF;
END $$;

-- Backfill delivery evidence so the three invoice crons behave identically
-- before and after this migration. Prefer the real email log; fall back to
-- invoice_date for rows whose status implies they went out before logging.
UPDATE public.invoices i
   SET sent_at = l.first_sent,
       sent_to = l.first_to
  FROM (
    SELECT DISTINCT ON (invoice_id)
           invoice_id,
           sent_at AS first_sent,
           sent_to AS first_to
      FROM public.invoice_email_logs
     WHERE invoice_id IS NOT NULL
       AND COALESCE(status, '') <> 'failed'
     ORDER BY invoice_id, sent_at
  ) l
 WHERE i.id = l.invoice_id
   AND i.sent_at IS NULL;

UPDATE public.invoices
   SET sent_at = (invoice_date::timestamp AT TIME ZONE 'Europe/London')
 WHERE sent_at IS NULL
   AND status IN ('sent', 'partially_paid', 'overdue', 'paid');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_sent_to_requires_sent_at'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_sent_to_requires_sent_at
      CHECK (sent_to IS NULL OR sent_at IS NOT NULL) NOT VALID;
    ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_sent_to_requires_sent_at;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_sent_at_due_date
  ON public.invoices (due_date)
  WHERE sent_at IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.invoices.sent_at IS
  'Authoritative delivery state. NULL = never delivered. status = ''sent'' is a legacy mirror and is NOT evidence of delivery.';
COMMENT ON COLUMN public.invoices.sent_to IS
  'Recipient address at first successful delivery.';
COMMENT ON COLUMN public.invoices.payment_state IS
  'GENERATED. unpaid | part_paid | paid. Use this rather than status for payment questions.';
