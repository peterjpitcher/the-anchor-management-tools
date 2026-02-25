-- Add AI confidence score and suggested rule keywords to receipt transactions
ALTER TABLE receipt_transactions
  ADD COLUMN IF NOT EXISTS ai_confidence SMALLINT CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 100)),
  ADD COLUMN IF NOT EXISTS ai_suggested_keywords TEXT;

COMMENT ON COLUMN receipt_transactions.ai_confidence IS 'AI classification confidence score 0-100 (null when not AI-classified)';
COMMENT ON COLUMN receipt_transactions.ai_suggested_keywords IS 'Comma-separated keywords suggested by AI for rule creation';
