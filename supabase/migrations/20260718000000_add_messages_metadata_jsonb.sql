-- The application logs SMS/WhatsApp context (queue_job_id, marketing/bulk flags,
-- booking ids, error details) into messages.metadata. The column was missing on
-- the production database, which produced "column messages.metadata does not exist"
-- errors from the SMS-queue evidence (.contains('metadata', ...)) and marketing
-- lookup paths, and forced the outbound-logging path (src/lib/sms/logging.ts) into
-- a metadata-dropping fallback. Adding the column is additive and non-destructive.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.messages.metadata IS 'Optional JSON context for the message (queue_job_id, marketing/bulk flags, booking ids, error details).';

-- Ensure PostgREST picks up the new column immediately.
NOTIFY pgrst, 'reload schema';
