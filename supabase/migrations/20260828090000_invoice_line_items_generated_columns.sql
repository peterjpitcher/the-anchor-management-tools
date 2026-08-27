-- Phase 0: bring source control up to production for invoice_line_items.
--
-- Production has had the four money columns on invoice_line_items as
-- GENERATED ALWAYS ... STORED for some time, but no migration in this repo ever
-- created them that way: every migration defines them as plain numeric columns
-- with DEFAULT 0. Production is therefore AHEAD of version control.
--
-- The practical consequence is that a database built from migrations alone
-- computes different line totals than production does, so any test suite built
-- on a fresh database proves nothing about production behaviour. That is why
-- this runs before any other work in the private-booking-invoice feature.
--
-- Expressions below are copied verbatim from production
-- (information_schema.columns.generation_expression, read 2026-08-27), so this
-- migration is a no-op against production and a correction everywhere else.
--
-- Note these expressions deliberately do NOT round, and deliberately do NOT
-- apply the invoice-level discount. Invoice header totals are computed in
-- TypeScript by calculateInvoiceTotals (src/lib/invoiceCalculations.ts), which
-- rounds VAT per line and apportions the invoice discount pro rata. Do not
-- "fix" the drift between the two here: changing these expressions would
-- silently restate every historical invoice line.

DO $$
DECLARE
  v_converted int := 0;
BEGIN
  -- subtotal_amount
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_line_items'
      AND column_name = 'subtotal_amount'
      AND is_generated = 'NEVER'
  ) THEN
    ALTER TABLE public.invoice_line_items DROP COLUMN subtotal_amount;
    ALTER TABLE public.invoice_line_items
      ADD COLUMN subtotal_amount numeric(10,2)
      GENERATED ALWAYS AS (quantity * unit_price) STORED;
    v_converted := v_converted + 1;
  END IF;

  -- discount_amount
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_line_items'
      AND column_name = 'discount_amount'
      AND is_generated = 'NEVER'
  ) THEN
    ALTER TABLE public.invoice_line_items DROP COLUMN discount_amount;
    ALTER TABLE public.invoice_line_items
      ADD COLUMN discount_amount numeric(10,2)
      GENERATED ALWAYS AS (
        ((quantity * unit_price) * discount_percentage) / (100)::numeric
      ) STORED;
    v_converted := v_converted + 1;
  END IF;

  -- vat_amount
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_line_items'
      AND column_name = 'vat_amount'
      AND is_generated = 'NEVER'
  ) THEN
    ALTER TABLE public.invoice_line_items DROP COLUMN vat_amount;
    ALTER TABLE public.invoice_line_items
      ADD COLUMN vat_amount numeric(10,2)
      GENERATED ALWAYS AS (
        (
          (quantity * unit_price)
          - (((quantity * unit_price) * discount_percentage) / (100)::numeric)
        ) * vat_rate / (100)::numeric
      ) STORED;
    v_converted := v_converted + 1;
  END IF;

  -- total_amount
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_line_items'
      AND column_name = 'total_amount'
      AND is_generated = 'NEVER'
  ) THEN
    ALTER TABLE public.invoice_line_items DROP COLUMN total_amount;
    ALTER TABLE public.invoice_line_items
      ADD COLUMN total_amount numeric(10,2)
      GENERATED ALWAYS AS (
        (
          (quantity * unit_price)
          - (((quantity * unit_price) * discount_percentage) / (100)::numeric)
        ) * ((1)::numeric + (vat_rate / (100)::numeric))
      ) STORED;
    v_converted := v_converted + 1;
  END IF;

  IF v_converted = 0 THEN
    RAISE NOTICE 'invoice_line_items money columns already generated, nothing to do';
  ELSE
    RAISE NOTICE 'invoice_line_items: converted % column(s) to GENERATED ALWAYS', v_converted;
  END IF;
END $$;

COMMENT ON COLUMN public.invoice_line_items.subtotal_amount IS
  'GENERATED. quantity * unit_price, unrounded, before any discount.';
COMMENT ON COLUMN public.invoice_line_items.discount_amount IS
  'GENERATED. Line-level discount only. Does NOT include the invoice-level discount.';
COMMENT ON COLUMN public.invoice_line_items.vat_amount IS
  'GENERATED, unrounded. Invoice header VAT is rounded per line by calculateInvoiceTotals and will differ.';
COMMENT ON COLUMN public.invoice_line_items.total_amount IS
  'GENERATED, unrounded, line-discount only. Not the customer-facing line total when an invoice-level discount applies.';
