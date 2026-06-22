-- Complete customer communications logging foundations.
-- Additive schema for email bodies, WhatsApp, unmatched inbound, routing attempts,
-- and a linked-only unified communications view.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

INSERT INTO storage.buckets (id, name, public)
VALUES ('communication-attachments', 'communication-attachments', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS body_text TEXT,
  ADD COLUMN IF NOT EXISTS body_html TEXT,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staff_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachments JSONB,
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_messages_status_check'
      AND conrelid = 'public.email_messages'::regclass
  ) THEN
    ALTER TABLE public.email_messages DROP CONSTRAINT email_messages_status_check;
  END IF;

  ALTER TABLE public.email_messages
    ADD CONSTRAINT email_messages_status_check
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
      'suppressed',
      'received',
      'read'
    ));

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_messages_direction_check'
      AND conrelid = 'public.email_messages'::regclass
  ) THEN
    ALTER TABLE public.email_messages
      ADD CONSTRAINT email_messages_direction_check
      CHECK (direction IN ('inbound', 'outbound'));
  END IF;
END $$;

UPDATE public.email_messages
SET direction = 'outbound'
WHERE direction IS NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_delivery_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_whatsapp_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_successful_whatsapp_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_deactivation_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_whatsapp_inbound_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_whatsapp_status_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_whatsapp_status_check
      CHECK (whatsapp_status IN ('unknown', 'active', 'opted_out', 'whatsapp_deactivated', 'invalid'));
  END IF;
END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachments JSONB;

CREATE TABLE IF NOT EXISTS public.unmatched_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  twilio_message_sid TEXT,
  resend_message_id TEXT,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachments JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  candidate_customer_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  status TEXT NOT NULL DEFAULT 'unmatched',
  linked_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  linked_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  linked_email_message_id UUID REFERENCES public.email_messages(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unmatched_communications_channel_check
    CHECK (channel IN ('sms', 'whatsapp', 'email')),
  CONSTRAINT unmatched_communications_direction_check
    CHECK (direction = 'inbound'),
  CONSTRAINT unmatched_communications_status_check
    CHECK (status IN ('unmatched', 'linked', 'ignored', 'deleted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS unmatched_communications_twilio_sid_key
  ON public.unmatched_communications (channel, twilio_message_sid);

CREATE UNIQUE INDEX IF NOT EXISTS unmatched_communications_resend_id_key
  ON public.unmatched_communications (channel, resend_message_id);

CREATE INDEX IF NOT EXISTS idx_unmatched_communications_status_received
  ON public.unmatched_communications (status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_unmatched_communications_linked_customer
  ON public.unmatched_communications (linked_customer_id)
  WHERE linked_customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_unmatched_communications_updated_at ON public.unmatched_communications;
CREATE TRIGGER update_unmatched_communications_updated_at
  BEFORE UPDATE ON public.unmatched_communications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.unmatched_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages unmatched communications" ON public.unmatched_communications;
CREATE POLICY "Service role manages unmatched communications"
  ON public.unmatched_communications
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.unmatched_communications FROM anon, authenticated;
GRANT ALL ON public.unmatched_communications TO service_role;

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  template_key TEXT NOT NULL,
  policy TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'transactional',
  urgency TEXT NOT NULL DEFAULT 'standard',
  selected_channel TEXT,
  final_status TEXT NOT NULL DEFAULT 'pending',
  delayed_fallback_allowed BOOLEAN NOT NULL DEFAULT false,
  delayed_fallback_sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_deliveries_category_check
    CHECK (category IN ('transactional', 'marketing')),
  CONSTRAINT notification_deliveries_urgency_check
    CHECK (urgency IN ('standard', 'time_critical')),
  CONSTRAINT notification_deliveries_channel_check
    CHECK (selected_channel IS NULL OR selected_channel IN ('email', 'whatsapp', 'sms')),
  CONSTRAINT notification_deliveries_status_check
    CHECK (final_status IN ('pending', 'sent', 'failed', 'delivered', 'bounced', 'suppressed', 'fallback_sent', 'no_channel'))
);

CREATE TABLE IF NOT EXISTS public.notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.notification_deliveries(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  attempt_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  twilio_message_sid TEXT,
  resend_message_id TEXT,
  error TEXT,
  idempotency_key TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT notification_attempts_channel_check
    CHECK (channel IN ('email', 'whatsapp', 'sms'))
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_customer_created
  ON public.notification_deliveries (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_template_created
  ON public.notification_deliveries (template_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_delivery_order
  ON public.notification_attempts (delivery_id, attempt_order);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_twilio_sid
  ON public.notification_attempts (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_attempts_resend_id
  ON public.notification_attempts (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notification_attempts_idempotency_key
  ON public.notification_attempts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS update_notification_deliveries_updated_at ON public.notification_deliveries;
CREATE TRIGGER update_notification_deliveries_updated_at
  BEFORE UPDATE ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages notification deliveries" ON public.notification_deliveries;
CREATE POLICY "Service role manages notification deliveries"
  ON public.notification_deliveries
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages notification attempts" ON public.notification_attempts;
CREATE POLICY "Service role manages notification attempts"
  ON public.notification_attempts
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.notification_deliveries FROM anon, authenticated;
REVOKE ALL ON public.notification_attempts FROM anon, authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;
GRANT ALL ON public.notification_attempts TO service_role;

CREATE INDEX IF NOT EXISTS idx_messages_customer_created
  ON public.messages (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_type_direction_created
  ON public.messages (message_type, direction, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_customer_created
  ON public.email_messages (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_received
  ON public.email_messages (received_at DESC)
  WHERE received_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_body_trgm
  ON public.email_messages USING gin ((COALESCE(subject, '') || ' ' || COALESCE(body_text, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_messages_body_trgm
  ON public.messages USING gin (body gin_trgm_ops);

DROP VIEW IF EXISTS public.customer_communications;
CREATE VIEW public.customer_communications AS
WITH sms_status_history AS (
  SELECT
    mds.message_id,
    jsonb_agg(
      jsonb_build_object(
        'status', mds.status,
        'error_code', mds.error_code,
        'error_message', mds.error_message,
        'created_at', mds.created_at,
        'note', mds.note
      )
      ORDER BY mds.created_at ASC
    ) AS delivery_history
  FROM public.message_delivery_status mds
  GROUP BY mds.message_id
),
feedback_rows AS (
  SELECT
    f.id,
    COALESCE(b.customer_id, tb.customer_id, pb.customer_id) AS customer_id,
    f.comments,
    f.created_at,
    f.event_booking_id,
    f.table_booking_id,
    f.private_booking_id
  FROM public.feedback f
  LEFT JOIN public.bookings b ON b.id = f.event_booking_id
  LEFT JOIN public.table_bookings tb ON tb.id = f.table_booking_id
  LEFT JOIN public.private_bookings pb ON pb.id = f.private_booking_id
)
SELECT
  (COALESCE(NULLIF(m.message_type, ''), 'sms') || ':' || m.id::text) AS id,
  m.customer_id,
  COALESCE(NULLIF(m.message_type, ''), 'sms')::TEXT AS channel,
  m.direction,
  m.status,
  NULL::TEXT AS subject,
  m.body AS body_text,
  NULL::TEXT AS body_html,
  m.from_number AS from_address,
  m.to_number AS to_address,
  m.created_at,
  m.sent_at,
  m.delivered_at,
  m.failed_at,
  m.read_at,
  NULL::TIMESTAMPTZ AS opened_at,
  NULL::TIMESTAMPTZ AS clicked_at,
  NULL::TIMESTAMPTZ AS bounced_at,
  CASE WHEN m.direction = 'inbound' THEN m.read_at ELSE NULL END AS staff_read_at,
  NULL::TIMESTAMPTZ AS replied_at,
  COALESCE(sh.delivery_history, '[]'::jsonb) AS delivery_history,
  COALESCE(m.has_attachments, false) AS has_attachments,
  m.attachments,
  jsonb_build_object(
    'review_clicked_at', NULL,
    'message_type', m.message_type
  ) AS engagement,
  jsonb_build_object(
    'event_id', NULL,
    'event_booking_id', m.event_booking_id,
    'table_booking_id', m.table_booking_id,
    'private_booking_id', m.private_booking_id,
    'parking_booking_id', NULL,
    'invoice_id', NULL,
    'quote_id', NULL
  ) AS context,
  m.twilio_message_sid,
  NULL::TEXT AS resend_message_id,
  m.cost_usd AS cost,
  m.segments,
  m.updated_at
FROM public.messages m
LEFT JOIN sms_status_history sh ON sh.message_id = m.id
WHERE m.customer_id IS NOT NULL
UNION ALL
SELECT
  ('email:' || em.id::text) AS id,
  em.customer_id,
  'email'::TEXT AS channel,
  em.direction,
  em.status,
  em.subject,
  em.body_text,
  em.body_html,
  em.from_address,
  em.to_address,
  COALESCE(em.received_at, em.sent_at, em.created_at) AS created_at,
  em.sent_at,
  em.delivered_at,
  COALESCE(em.failed_at, em.bounced_at, em.complained_at) AS failed_at,
  NULL::TIMESTAMPTZ AS read_at,
  em.opened_at,
  em.clicked_at,
  em.bounced_at,
  em.staff_read_at,
  em.replied_at,
  '[]'::jsonb AS delivery_history,
  COALESCE(em.has_attachments, false) AS has_attachments,
  em.attachments,
  jsonb_build_object(
    'opened_at', em.opened_at,
    'clicked_at', em.clicked_at
  ) AS engagement,
  jsonb_build_object(
    'event_id', NULL,
    'event_booking_id', em.event_booking_id,
    'table_booking_id', em.table_booking_id,
    'private_booking_id', em.private_booking_id,
    'parking_booking_id', em.parking_booking_id,
    'invoice_id', em.invoice_id,
    'quote_id', em.quote_id
  ) AS context,
  NULL::TEXT AS twilio_message_sid,
  em.resend_message_id,
  NULL::NUMERIC AS cost,
  NULL::INTEGER AS segments,
  em.updated_at
FROM public.email_messages em
WHERE em.customer_id IS NOT NULL
UNION ALL
SELECT
  ('feedback:' || fr.id::text) AS id,
  fr.customer_id,
  'feedback'::TEXT AS channel,
  'inbound'::TEXT AS direction,
  'received'::TEXT AS status,
  'Feedback'::TEXT AS subject,
  fr.comments AS body_text,
  NULL::TEXT AS body_html,
  NULL::TEXT AS from_address,
  NULL::TEXT AS to_address,
  fr.created_at,
  NULL::TIMESTAMPTZ AS sent_at,
  NULL::TIMESTAMPTZ AS delivered_at,
  NULL::TIMESTAMPTZ AS failed_at,
  NULL::TIMESTAMPTZ AS read_at,
  NULL::TIMESTAMPTZ AS opened_at,
  NULL::TIMESTAMPTZ AS clicked_at,
  NULL::TIMESTAMPTZ AS bounced_at,
  NULL::TIMESTAMPTZ AS staff_read_at,
  NULL::TIMESTAMPTZ AS replied_at,
  '[]'::jsonb AS delivery_history,
  false AS has_attachments,
  NULL::jsonb AS attachments,
  '{}'::jsonb AS engagement,
  jsonb_build_object(
    'event_id', NULL,
    'event_booking_id', fr.event_booking_id,
    'table_booking_id', fr.table_booking_id,
    'private_booking_id', fr.private_booking_id,
    'parking_booking_id', NULL,
    'invoice_id', NULL,
    'quote_id', NULL
  ) AS context,
  NULL::TEXT AS twilio_message_sid,
  NULL::TEXT AS resend_message_id,
  NULL::NUMERIC AS cost,
  NULL::INTEGER AS segments,
  fr.created_at AS updated_at
FROM feedback_rows fr
WHERE fr.customer_id IS NOT NULL;

REVOKE ALL ON public.customer_communications FROM anon, authenticated;
GRANT SELECT ON public.customer_communications TO service_role;
