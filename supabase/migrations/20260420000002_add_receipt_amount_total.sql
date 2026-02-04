ALTER TABLE receipt_transactions
  ADD COLUMN IF NOT EXISTS amount_total NUMERIC(12, 2)
  GENERATED ALWAYS AS (COALESCE(amount_out, amount_in)) STORED;

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_amount_total
  ON receipt_transactions (amount_total DESC);
