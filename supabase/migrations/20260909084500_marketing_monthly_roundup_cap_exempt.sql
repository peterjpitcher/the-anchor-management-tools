-- Lets a campaign opt out of the frequency cap, for the monthly round-up.
--
-- The owner's decision, 9 September 2026: the monthly "Welcome to <month>" email is the
-- drumbeat and should not be blocked by, or block, an event email that happens to fall
-- beside it. Every other campaign is unchanged and still capped.
--
-- WHY THIS NEEDS SQL AT ALL. Scheduling is not where the cap bites. `scheduleCampaign`
-- refuses an obvious collision as a courtesy, but the real enforcement is inside
-- `claim_marketing_recipients`, which skips any recipient whose last marketing email is
-- inside the window and marks them `frequency_cap`. A campaign scheduled past the TypeScript
-- guard would still be claimed by nobody and finish `completed` having reached no one, which
-- is the exact silent failure this system was built to avoid. So the exemption has to live
-- where the decision is made.
--
-- THE EXEMPTION IS TWO-SIDED, ON PURPOSE. A round-up that ignored the cap on the way in but
-- still stamped `marketing_last_email_at` on the way out would simply move the problem: the
-- next event email would be the one silently emptied. An exempt campaign therefore neither
-- reads the cap nor advances the recipient's last-email timestamp. It is invisible to the
-- cap in both directions, which is what "the monthly one does not count" actually means.
--
-- Everything else the cap protects is untouched: opt-outs, bounces, do-not-contact,
-- eligibility, the send window, the kill switch and the reservation lease all still apply,
-- and an exempt campaign is subject to every one of them.

BEGIN;

ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS ignores_frequency_cap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.marketing_campaigns.ignores_frequency_cap IS
  'The monthly round-up opts out of the frequency cap in both directions: it is not blocked '
  'by a recent send, and it does not advance marketing_last_email_at. Everything else stays '
  'capped. Set deliberately, never as a way to get a late campaign out.';

-- Claim: read the flag from the campaign we already join to, and skip the cap check for it.
CREATE OR REPLACE FUNCTION public.claim_marketing_recipients(p_batch integer)
RETURNS SETOF public.marketing_campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_settings public.marketing_settings%ROWTYPE;
  v_candidate record;
  v_contact public.business_contacts%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_row public.marketing_campaign_recipients%ROWTYPE;
  v_claimed integer := 0;
  v_lease interval := interval '10 minutes';
  v_skip text;
  v_email text;
  v_last timestamptz;
  v_reserved timestamptz;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 200 THEN
    RAISE EXCEPTION 'claim_marketing_recipients: p_batch must be between 1 and 200, got %', p_batch;
  END IF;

  SELECT * INTO v_settings FROM public.marketing_settings WHERE id LIMIT 1;
  IF NOT FOUND OR NOT v_settings.sends_enabled THEN RETURN; END IF;

  FOR v_candidate IN
    SELECT r.id AS recipient_id, r.contact_id, r.customer_id, r.failure_class, r.last_attempt_at,
           c.ignores_frequency_cap
    FROM public.marketing_campaign_recipients r
    JOIN public.marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.status = 'pending'
      AND c.status = 'sending'
      AND public.marketing_send_window_open(c.audience_type)
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    ORDER BY r.created_at
    LIMIT GREATEST(p_batch * 4, 20)
  LOOP
    EXIT WHEN v_claimed >= p_batch;

    IF v_candidate.failure_class = 'unknown'
       AND v_candidate.last_attempt_at IS NOT NULL
       AND v_candidate.last_attempt_at < now() - interval '24 hours' THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'needs_review',
             error = 'Recovered from an attempt whose outcome could not be proved, and the provider idempotency window has since closed'
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    v_skip := NULL;

    IF v_candidate.customer_id IS NOT NULL THEN
      SELECT * INTO v_customer FROM public.customers
       WHERE id = v_candidate.customer_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      v_email := lower(btrim(COALESCE(v_customer.email, '')));
      v_last := v_customer.marketing_last_email_at;
      v_reserved := v_customer.marketing_reserved_until;

      IF v_email = '' THEN
        v_skip := 'not_eligible';
      ELSIF v_customer.marketing_email_opted_out_at IS NOT NULL THEN
        v_skip := 'unsubscribed';
      ELSIF COALESCE(v_customer.email_status, 'unknown') = 'bounced' THEN
        v_skip := 'suppressed';
      ELSIF NOT (
        v_customer.marketing_email_opt_in IS TRUE
        OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = v_customer.id)
        OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = v_customer.id)
      ) THEN
        v_skip := 'not_eligible';
      END IF;
    ELSE
      SELECT * INTO v_contact FROM public.business_contacts
       WHERE id = v_candidate.contact_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      v_email := v_contact.email;
      v_last := v_contact.last_marketing_email_at;
      v_reserved := v_contact.marketing_reserved_until;

      IF v_contact.eligibility_status <> 'eligible' THEN
        v_skip := 'not_eligible';
      ELSIF v_contact.marketing_status <> 'subscribed' THEN
        v_skip := 'unsubscribed';
      END IF;
    END IF;

    IF v_skip IS NULL AND EXISTS (
      SELECT 1 FROM public.marketing_do_not_contact d
      WHERE d.email_normalised = v_email AND d.removed_at IS NULL
    ) THEN
      v_skip := 'do_not_contact';
    END IF;

    -- The only change from the previous definition: an exempt campaign does not consult the
    -- cap. Every other skip reason above still applies to it.
    IF v_skip IS NULL AND NOT COALESCE(v_candidate.ignores_frequency_cap, false)
       AND v_settings.frequency_cap_days > 0
       AND v_last IS NOT NULL
       AND v_last > now() - make_interval(days => v_settings.frequency_cap_days) THEN
      v_skip := 'frequency_cap';
    END IF;

    IF v_skip IS NOT NULL THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'skipped', skip_reason = v_skip
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    CONTINUE WHEN v_reserved IS NOT NULL AND v_reserved > now();

    IF v_candidate.customer_id IS NOT NULL THEN
      UPDATE public.customers SET marketing_reserved_until = now() + v_lease
       WHERE id = v_candidate.customer_id;
    ELSE
      UPDATE public.business_contacts SET marketing_reserved_until = now() + v_lease
       WHERE id = v_candidate.contact_id;
    END IF;

    UPDATE public.marketing_campaign_recipients
       SET status = 'sending', claimed_at = now(), lease_expires_at = now() + v_lease,
           attempt_count = attempt_count + 1, last_attempt_at = now()
     WHERE id = v_candidate.recipient_id AND status = 'pending'
    RETURNING * INTO v_row;

    CONTINUE WHEN NOT FOUND;

    v_claimed := v_claimed + 1;
    RETURN NEXT v_row;
  END LOOP;
END;
$$;

-- Finalise: the other side of the exemption. An exempt campaign releases the reservation and
-- records nothing that would cap the next email.
CREATE OR REPLACE FUNCTION public.finalise_marketing_send(
  p_recipient_id uuid,
  p_email_message_id uuid,
  p_provider_message_id text,
  p_needs_review boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recipient public.marketing_campaign_recipients%ROWTYPE;
  v_exempt boolean;
BEGIN
  UPDATE public.marketing_campaign_recipients
     SET status = CASE WHEN p_needs_review THEN 'needs_review' ELSE 'sent' END,
         sent_at = now(),
         email_message_id = p_email_message_id,
         provider_message_id = p_provider_message_id,
         lease_expires_at = NULL,
         error = CASE WHEN p_needs_review
                      THEN 'Provider accepted the send but the local log row was not written'
                      ELSE NULL END
   WHERE id = p_recipient_id
  RETURNING * INTO v_recipient;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalise_marketing_send: recipient % not found', p_recipient_id;
  END IF;

  SELECT COALESCE(c.ignores_frequency_cap, false) INTO v_exempt
    FROM public.marketing_campaigns c WHERE c.id = v_recipient.campaign_id;

  IF v_recipient.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET marketing_last_email_at = CASE WHEN v_exempt THEN marketing_last_email_at ELSE now() END,
           marketing_last_campaign_id = CASE WHEN v_exempt THEN marketing_last_campaign_id ELSE v_recipient.campaign_id END,
           marketing_reserved_until = NULL
     WHERE id = v_recipient.customer_id;
  ELSE
    UPDATE public.business_contacts
       SET last_marketing_email_at = CASE WHEN v_exempt THEN last_marketing_email_at ELSE now() END,
           last_marketing_campaign_id = CASE WHEN v_exempt THEN last_marketing_campaign_id ELSE v_recipient.campaign_id END,
           marketing_reserved_until = NULL
     WHERE id = v_recipient.contact_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_marketing_recipients(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_recipients(integer) TO service_role;
REVOKE ALL ON FUNCTION public.finalise_marketing_send(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalise_marketing_send(uuid, uuid, text, boolean) TO service_role;

COMMIT;
