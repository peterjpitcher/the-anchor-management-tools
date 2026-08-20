-- Email capture: a one-tap SMS link that asks a guest for the one thing we do not have.
--
-- Measured 19 August 2026: 1,090 customers, 290 with an email address, 225 eligible for a
-- guest email campaign. 466 are SMS-reachable with no email on file at all, and 423 of those
-- have booked at least once, which is the soft opt-in basis this send relies on.
--
-- Two things are added here:
--   1. 'email_capture' as a guest_tokens action type, so each recipient gets their own
--      single-use link and the address lands on THEIR customer record.
--   2. get_email_capture_audience(), which defines that segment in one place.
--
-- Why a tokenised link rather than a generic one pointing at a public sign-up form:
-- customers.email is uniquely indexed and a public form upserts on it, so a guest with no
-- email on file would create a NEW customer record instead of updating theirs. That produces
-- duplicates for precisely the people this send exists to enrich, and staff then merge them
-- by hand. The token removes the guesswork: we already know who they are.

-- ---------------------------------------------------------------------------
-- 1. The new action type
-- ---------------------------------------------------------------------------

ALTER TABLE public.guest_tokens
  DROP CONSTRAINT IF EXISTS guest_tokens_action_type_check;

ALTER TABLE public.guest_tokens
  ADD CONSTRAINT guest_tokens_action_type_check CHECK (
    action_type = ANY (ARRAY[
      'manage'::text,
      'sunday_preorder'::text,
      'card_capture'::text,
      'payment'::text,
      'review_redirect'::text,
      'charge_approval'::text,
      'waitlist_offer'::text,
      'private_feedback'::text,
      'private_booking_outcome'::text,
      'booking_confirm'::text,
      'email_capture'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. Somewhere honest to record how the address was obtained
-- ---------------------------------------------------------------------------
--
-- customer_consents is the ledger that answers "why are we allowed to email this person",
-- so it has to describe the real route. Neither an existing capture_method nor an existing
-- source fits a one-tap link sent by text: the closest, 'api_field' and 'direct_message',
-- would both record something that did not happen.
--
-- This consent is EXPLICIT, not soft opt-in. The guest was shown a labelled ask and typed
-- their address in response, so it is recorded with legal_basis = 'consent'.

ALTER TABLE public.customer_consents
  DROP CONSTRAINT IF EXISTS customer_consents_capture_method_check;

ALTER TABLE public.customer_consents
  ADD CONSTRAINT customer_consents_capture_method_check CHECK (
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
      'unsubscribe_link'::text,
      'sms_one_tap'::text
    ])
  );

ALTER TABLE public.customer_consents
  DROP CONSTRAINT IF EXISTS customer_consents_source_check;

ALTER TABLE public.customer_consents
  ADD CONSTRAINT customer_consents_source_check CHECK (
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
      'email_unsubscribe_link'::text,
      'guest_email_capture_link'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 3. The audience
-- ---------------------------------------------------------------------------

-- Who should be asked for an email address by text.
--
-- Predicates, and why each one is here:
--   no email on file          the entire point; anyone with one is already reachable
--   mobile_e164 present       there must be a number to text
--   sms_status = 'active'     not stopped, not deactivated by carrier failures
--   messaging_status='active' not suspended or marked invalid
--   not marketing-opted-out   NOEVENTS is honoured by marketing_sms_opted_out_at
--   has booked at least once  the soft opt-in basis. Without a prior booking there is no
--                             existing relationship, and PECR soft opt-in does not reach them.
--   no prior email_capture    natural idempotency. Re-running must never re-text someone who
--                             was already asked, whether or not they answered. This is the
--                             single guard that makes the send safe to run twice by accident.
--
-- Ordered warmest first, so that if a run is capped or interrupted the people most likely to
-- answer have already been reached.
--
-- "Warmest" is deliberately the greatest of two different things: the DATE of their most
-- recent table booking, and WHEN they last made an event booking. Those are not the same
-- measure, and mixing them is intentional rather than sloppy: a guest with a table booked
-- three weeks from now sorts above one who booked an event last month, which is the correct
-- order to ask them in. It is named last_activity_on rather than last_booked_on because a
-- future date is a normal and expected value here.
CREATE OR REPLACE FUNCTION public.get_email_capture_audience(p_max_recipients integer DEFAULT 500)
RETURNS TABLE (
  customer_id uuid,
  first_name text,
  phone_number text,
  last_activity_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id::uuid,
    c.first_name::text,
    c.mobile_e164::text,
    GREATEST(
      COALESCE(c.last_table_booking_date, '1900-01-01'::date),
      COALESCE((SELECT max(b.created_at)::date FROM public.bookings b WHERE b.customer_id = c.id), '1900-01-01'::date)
    )::date AS last_activity_on
  FROM public.customers c
  WHERE (c.email IS NULL OR btrim(c.email) = '')
    AND c.mobile_e164 IS NOT NULL
    AND c.sms_status = 'active'
    AND c.messaging_status = 'active'
    AND c.marketing_sms_opted_out_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = c.id)
      OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = c.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.guest_tokens g
      WHERE g.customer_id = c.id AND g.action_type = 'email_capture'
    )
  ORDER BY last_activity_on DESC, c.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_max_recipients, 500), 1000));
$function$;

COMMENT ON FUNCTION public.get_email_capture_audience(integer) IS
  'Customers who are SMS-reachable but have no email address, have booked before (the soft opt-in basis), and have not already been sent an email_capture link. Ordered warmest first.';

-- REVOKE FROM PUBLIC alone does not remove a grant made to a named role, which is the trap
-- migration 20260801001300 exists to document. Revoke from anon and authenticated explicitly.
REVOKE ALL ON FUNCTION public.get_email_capture_audience(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_capture_audience(integer) TO service_role;

-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.get_email_capture_audience(integer);
--   -- then restore the previous CHECK, which is this one minus 'email_capture'.
--   -- Any guest_tokens rows with action_type = 'email_capture' must be deleted first, or
--   -- the constraint will not validate.
