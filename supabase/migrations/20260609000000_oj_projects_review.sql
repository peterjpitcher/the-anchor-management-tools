-- =============================================================================
-- Migration: 20260609000000_oj_projects_review.sql
-- Purpose: Fix one_off constraint gap, add payment_id to invoice_email_logs,
--          create credit_notes table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1: Fix one_off constraint on oj_entries
-- ---------------------------------------------------------------------------

-- Step 1: Audit — count violating rows (logged for visibility via RAISE NOTICE)
DO $$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*) INTO violation_count
  FROM oj_entries
  WHERE entry_type = 'one_off'
    AND (miles IS NOT NULL OR duration_minutes_rounded IS NOT NULL
         OR hourly_rate_snapshot IS NOT NULL OR mileage_rate_snapshot IS NOT NULL);
  RAISE NOTICE 'one_off constraint violations found: %', violation_count;
END $$;

-- Step 2: Data fix — null out spurious values BEFORE adding constraint
UPDATE oj_entries
SET miles = NULL,
    duration_minutes_rounded = NULL,
    hourly_rate_snapshot = NULL,
    mileage_rate_snapshot = NULL
WHERE entry_type = 'one_off'
  AND (miles IS NOT NULL OR duration_minutes_rounded IS NOT NULL
       OR hourly_rate_snapshot IS NOT NULL OR mileage_rate_snapshot IS NOT NULL);

-- Step 3: Drop old constraint and add comprehensive version
ALTER TABLE oj_entries DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
ALTER TABLE oj_entries ADD CONSTRAINT chk_oj_entries_time_fields CHECK (
  (entry_type = 'time' AND duration_minutes_rounded IS NOT NULL AND hourly_rate_snapshot IS NOT NULL
   AND miles IS NULL AND mileage_rate_snapshot IS NULL AND amount_ex_vat_snapshot IS NULL)
  OR
  (entry_type = 'mileage' AND miles IS NOT NULL AND mileage_rate_snapshot IS NOT NULL
   AND duration_minutes_rounded IS NULL AND hourly_rate_snapshot IS NULL AND amount_ex_vat_snapshot IS NULL)
  OR
  (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL
   AND duration_minutes_rounded IS NULL AND miles IS NULL
   AND hourly_rate_snapshot IS NULL AND mileage_rate_snapshot IS NULL)
);

-- ---------------------------------------------------------------------------
-- PART 2: Add payment_id to invoice_email_logs for receipt dedup
-- ---------------------------------------------------------------------------

ALTER TABLE invoice_email_logs
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES invoice_payments(id);

CREATE INDEX IF NOT EXISTS idx_invoice_email_logs_payment_id
  ON invoice_email_logs(payment_id)
  WHERE payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PART 3: Create credit_notes table
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
