BEGIN;

CREATE TABLE IF NOT EXISTS public.receipt_upload_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  issued_to UUID NOT NULL,
  original_file_name TEXT,
  file_type TEXT,
  file_size_bytes BIGINT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  receipt_file_id UUID REFERENCES public.receipt_files(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_upload_intents_storage_path
  ON public.receipt_upload_intents(storage_path);

CREATE INDEX IF NOT EXISTS idx_receipt_upload_intents_transaction_open
  ON public.receipt_upload_intents(transaction_id, issued_to, completed_at);

ALTER TABLE public.receipt_upload_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access" ON public.receipt_upload_intents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
