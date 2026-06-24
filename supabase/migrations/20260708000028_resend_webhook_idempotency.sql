-- A-065: make Resend webhook delivery claims idempotent by Svix id.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_logs_resend_svix_id
  ON public.webhook_logs ((params->>'svix_id'))
  WHERE webhook_type = 'resend'
    AND params ? 'svix_id';
