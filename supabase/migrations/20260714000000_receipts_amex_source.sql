-- Add source_type + Amex metadata to receipt transactions and batches.
-- Purely additive: existing rows backfill to 'bank' via the column default.

ALTER TABLE public.receipt_transactions
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'bank',
  ADD COLUMN IF NOT EXISTS card_member TEXT,
  ADD COLUMN IF NOT EXISTS card_account TEXT,
  ADD COLUMN IF NOT EXISTS merchant_category TEXT,
  ADD COLUMN IF NOT EXISTS merchant_town TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT IF EXISTS receipt_transactions_source_type_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_source_type_check
  CHECK (source_type IN ('bank', 'amex'));

ALTER TABLE public.receipt_batches
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'bank';
ALTER TABLE public.receipt_batches
  DROP CONSTRAINT IF EXISTS receipt_batches_source_type_check;
ALTER TABLE public.receipt_batches
  ADD CONSTRAINT receipt_batches_source_type_check
  CHECK (source_type IN ('bank', 'amex'));

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_source_type
  ON public.receipt_transactions (source_type);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_card_member
  ON public.receipt_transactions (card_member)
  WHERE source_type = 'amex';

-- Help the duplicate-file guard pre-check (see service layer).
CREATE INDEX IF NOT EXISTS idx_receipt_batches_source_hash
  ON public.receipt_batches (source_hash);
