-- Email communications + Resend deliverability infrastructure.
-- Additive only: customer email health columns, send log, suppression list, and
-- a read-only unified customer communications view.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS email_delivery_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_email_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_successful_email_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_email_status_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_email_status_check
      CHECK (email_status IN ('unknown', 'valid', 'bounced', 'complained', 'invalid'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  to_address TEXT NOT NULL,
  from_address TEXT,
  comm_type TEXT,
  subject TEXT,
  resend_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  table_booking_id UUID REFERENCES public.table_bookings(id) ON DELETE SET NULL,
  event_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  private_booking_id UUID REFERENCES public.private_bookings(id) ON DELETE SET NULL,
  parking_booking_id UUID REFERENCES public.parking_bookings(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_delayed_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_messages_status_check
    CHECK (status IN (
      'queued',
      'sent',
      'delivered',
      'delivery_delayed',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'failed',
      'suppressed'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_resend_message_id_key
  ON public.email_messages (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_customer_created
  ON public.email_messages (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_to_address
  ON public.email_messages (LOWER(to_address));

CREATE INDEX IF NOT EXISTS idx_email_messages_status_created
  ON public.email_messages (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  resend_email_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_suppressions_reason_check
    CHECK (reason IN ('bounce', 'complaint', 'suppression', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_reason_created
  ON public.email_suppressions (reason, created_at DESC);

DROP TRIGGER IF EXISTS update_email_messages_updated_at ON public.email_messages;
CREATE TRIGGER update_email_messages_updated_at
  BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_suppressions_updated_at ON public.email_suppressions;
CREATE TRIGGER update_email_suppressions_updated_at
  BEFORE UPDATE ON public.email_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages email messages" ON public.email_messages;
CREATE POLICY "Service role manages email messages"
  ON public.email_messages
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages email suppressions" ON public.email_suppressions;
CREATE POLICY "Service role manages email suppressions"
  ON public.email_suppressions
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.email_messages FROM anon, authenticated;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;
GRANT ALL ON public.email_messages TO service_role;
GRANT ALL ON public.email_suppressions TO service_role;

DROP VIEW IF EXISTS public.customer_communications;
CREATE VIEW public.customer_communications AS
SELECT
  m.id,
  m.customer_id,
  'sms'::TEXT AS channel,
  m.template_key AS comm_type,
  m.status,
  NULL::TEXT AS subject,
  m.body,
  m.from_number AS from_address,
  m.to_number AS to_address,
  m.sent_at,
  m.delivered_at,
  m.failed_at,
  m.created_at,
  m.updated_at
FROM public.messages m
WHERE m.direction = 'outbound'
UNION ALL
SELECT
  em.id,
  em.customer_id,
  'email'::TEXT AS channel,
  em.comm_type,
  em.status,
  em.subject,
  NULL::TEXT AS body,
  em.from_address,
  em.to_address,
  em.sent_at,
  em.delivered_at,
  COALESCE(em.failed_at, em.bounced_at, em.complained_at) AS failed_at,
  em.created_at,
  em.updated_at
FROM public.email_messages em;

REVOKE ALL ON public.customer_communications FROM anon, authenticated;
GRANT SELECT ON public.customer_communications TO service_role;
