-- A working one-click unsubscribe for marketing email.
--
-- WHY NOW: the venue moved SMS marketing onto a soft opt-in footing on 8 August
-- (20260808100000_cross_promo_soft_opt_in_audience.sql). That migration is explicit that
-- the legal basis only holds while "the opt-out itself is offered at the point of
-- collection and in every marketing message", and says that part is enforced in
-- application code. Email is about to move to the same footing, and today there is no
-- unsubscribe of any kind. This builds the opt-out FIRST, so the notice that goes on the
-- booking form afterwards is a true statement rather than a promise nothing can keep.
--
-- The customers table already carries marketing_email_opted_out_at, and
-- record_customer_consent() already flips it. Nothing here invents a consent model; it
-- adds the door the guest walks out of.

BEGIN;

-- 1. The token behind the link in the footer.
--
-- DELIBERATELY NOT `guest_tokens`. Those are per-action, expiring and single-use, which
-- is right for "confirm this booking" and wrong here: an unsubscribe link in an email
-- from a year ago must still work, or the opt-out we are relying on legally is a link
-- that quietly 404s. One durable token per customer, reused across every message.
--
-- AND DELIBERATELY NOT HASHED, which is the other difference from guest_tokens. Those are
-- hashed because they can cancel a booking or authorise a payment. This token can do
-- exactly one thing: stop marketing email reaching one person. That is low harm, fully
-- reversible, and the outcome the guest was asking for. Against that, a hash cannot be
-- reversed, so a hashed token could never be put back into next month's email and the
-- link would have to rotate on every send. Rotating breaks every link already sitting in
-- somebody's inbox, which defeats the entire point. RLS is on and only service_role can
-- read the table.
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  token        text PRIMARY KEY,
  customer_id  uuid NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  use_count    integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.email_unsubscribe_tokens IS
  'One durable unsubscribe token per customer. Never expires and never rotates: an unsubscribe link in an old email has to keep working, because it is the opt-out the soft opt-in basis depends on.';

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_unsubscribe_tokens FROM anon, authenticated;
GRANT ALL ON public.email_unsubscribe_tokens TO service_role;

-- Usage stamp, as a function so the route can record it without a second round trip and
-- without needing UPDATE reasoning in application code. Best effort by design: the
-- caller ignores failures, because losing a counter must never tell a guest their
-- unsubscribe did not work.
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

REVOKE ALL ON FUNCTION public.record_unsubscribe_token_use(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_unsubscribe_token_use(text) TO service_role;

-- 2. Let the audit trail name where the opt-out came from.
--
-- Both CHECKs are rebuilt from the LIVE definitions rather than from any migration, and
-- every existing value is carried across unchanged. Dropping one by reconstructing the
-- list from memory would fail against rows already using it.
ALTER TABLE public.customer_consents DROP CONSTRAINT IF EXISTS customer_consents_source_check;
ALTER TABLE public.customer_consents ADD CONSTRAINT customer_consents_source_check CHECK (
  source = ANY (ARRAY[
    'public_table_booking'::text,
    'public_event_booking'::text,
    'public_event_waitlist'::text,
    'public_private_booking'::text,
    'public_parking_booking'::text,
    'staff_table_booking'::text,
    'staff_event_booking'::text,
    'staff_private_booking'::text,
    'staff_parking_booking'::text,
    'customer_profile'::text,
    'customer_import'::text,
    'customer_lookup_legacy'::text,
    'twilio_inbound_sms'::text,
    'twilio_inbound_whatsapp'::text,
    'direct_message'::text,
    'system_migration'::text,
    'gdpr_action'::text,
    'email_unsubscribe_link'::text
  ])
);

ALTER TABLE public.customer_consents DROP CONSTRAINT IF EXISTS customer_consents_capture_method_check;
ALTER TABLE public.customer_consents ADD CONSTRAINT customer_consents_capture_method_check CHECK (
  capture_method = ANY (ARRAY[
    'checkbox'::text,
    'staff_verbal'::text,
    'profile_toggle'::text,
    'import_attestation'::text,
    'api_field'::text,
    'inbound_keyword'::text,
    'system_migration'::text,
    'service_notice'::text,
    'provider_event'::text,
    'unsubscribe_link'::text
  ])
);

COMMIT;
