-- Backfill: mark historical transactions as not requiring receipts
-- Context: VAT already processed through June 2025; prevent old entries from appearing outstanding.

BEGIN;

WITH candidates AS (
  SELECT id, status AS previous_status
  FROM receipt_transactions
  WHERE transaction_date <= DATE '2025-06-30'
    AND status = 'pending'
),
updated AS (
  UPDATE receipt_transactions rt
  SET
    status = 'no_receipt_required',
    receipt_required = false,
    marked_by = NULL,
    marked_by_email = NULL,
    marked_by_name = NULL,
    marked_at = NOW(),
    marked_method = 'migration_backfill',
    rule_applied_id = NULL,
    updated_at = NOW()
  FROM candidates
  WHERE rt.id = candidates.id
  RETURNING rt.id, candidates.previous_status
)
INSERT INTO receipt_transaction_logs (
  transaction_id,
  previous_status,
  new_status,
  action_type,
  note,
  performed_by,
  rule_id,
  performed_at
)
SELECT
  updated.id,
  updated.previous_status,
  'no_receipt_required',
  'migration_backfill',
  'Marked as not required by June 2025 migration',
  NULL,
  NULL,
  NOW()
FROM updated;

COMMIT;
