-- =============================================================================
-- Migration: 20260609000000_oj_projects_review.sql
-- Purpose: Add payment_id to invoice_email_logs, create credit_notes table
-- Note: one_off constraint already fixed in 20260512000000
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1: Add payment_id to invoice_email_logs for receipt dedup
-- ---------------------------------------------------------------------------

ALTER TABLE invoice_email_logs
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES invoice_payments(id);

CREATE INDEX IF NOT EXISTS idx_invoice_email_logs_payment_id
  ON invoice_email_logs(payment_id)
  WHERE payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PART 2: Create credit_notes table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  credit_note_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  vendor_id uuid NOT NULL REFERENCES invoice_vendors(id),
  amount_ex_vat numeric(12,2) NOT NULL,
  vat_rate numeric(5,2) NOT NULL DEFAULT 20,
  amount_inc_vat numeric(12,2) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read credit_notes"
  ON credit_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert credit_notes"
  ON credit_notes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update credit_notes"
  ON credit_notes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_id ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_vendor_id ON credit_notes(vendor_id);
