-- B2B marketing email: changes to existing tables.
--
-- All additive. The customer unsubscribe path keeps its exact current behaviour: the only
-- change is that a token may now belong to a business contact instead of a customer.

BEGIN;

-- ---------------------------------------------------------------------------
-- Unsubscribe tokens gain a second subject type
-- ---------------------------------------------------------------------------

ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN IF NOT EXISTS business_contact_id uuid
    REFERENCES public.business_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.email_unsubscribe_tokens
  ALTER COLUMN customer_id DROP NOT NULL;

-- Exactly one subject per token. Existing rows all have customer_id set and the new column
-- null, so this validates without a rewrite.
ALTER TABLE public.email_unsubscribe_tokens
  DROP CONSTRAINT IF EXISTS email_unsubscribe_tokens_one_subject;
ALTER TABLE public.email_unsubscribe_tokens
  ADD CONSTRAINT email_unsubscribe_tokens_one_subject
  CHECK ((customer_id IS NULL) <> (business_contact_id IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS email_unsubscribe_tokens_contact_key
  ON public.email_unsubscribe_tokens (business_contact_id)
  WHERE business_contact_id IS NOT NULL;

COMMENT ON TABLE public.email_unsubscribe_tokens IS
  'One durable unsubscribe token per subject. A subject is either a customer or a business '
  'contact, never both. Tokens are stored in the clear and never expire or rotate on purpose: '
  'an unsubscribe link in an email sent last year must still work.';

-- record_unsubscribe_token_use() keys on the token alone, so it needs no change for a null
-- customer_id. Re-declared here so the behaviour is pinned against future edits.
CREATE OR REPLACE FUNCTION public.record_unsubscribe_token_use(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.email_unsubscribe_tokens
     SET last_used_at = now(),
         use_count = use_count + 1
   WHERE token = p_token;
$function$;

REVOKE ALL ON FUNCTION public.record_unsubscribe_token_use(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_unsubscribe_token_use(text) TO service_role;

-- ---------------------------------------------------------------------------
-- email_messages: stable links back to the marketing rows
--
-- Without these the webhook can only match a bounce or complaint by email address, which
-- silently misses a contact whose address changed after the send.
-- ---------------------------------------------------------------------------

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS business_contact_id uuid
    REFERENCES public.business_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_campaign_id uuid
    REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_recipient_id uuid
    REFERENCES public.marketing_campaign_recipients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_messages_business_contact_idx
  ON public.email_messages (business_contact_id)
  WHERE business_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_marketing_campaign_idx
  ON public.email_messages (marketing_campaign_id)
  WHERE marketing_campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Webhook events that match no local row
--
-- A status update that hits zero rows currently gets marked processed and disappears. For
-- marketing that means losing the delivery record entirely, so unmatched events are parked
-- here instead of being dropped.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_webhook_unmatched (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text,
  event_type text NOT NULL,
  to_address text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_webhook_unmatched_open_idx
  ON public.email_webhook_unmatched (created_at) WHERE resolved_at IS NULL;

ALTER TABLE public.email_webhook_unmatched ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_webhook_unmatched FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_webhook_unmatched TO service_role;

-- ---------------------------------------------------------------------------
-- Short links: a type for marketing so campaign links stay filterable in analytics
-- ---------------------------------------------------------------------------

ALTER TABLE public.short_links DROP CONSTRAINT IF EXISTS short_links_link_type_check;
ALTER TABLE public.short_links ADD CONSTRAINT short_links_link_type_check
  CHECK (link_type IN (
    'loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption',
    'custom', 'booking_confirmation', 'marketing_email'
  ));

COMMIT;
