-- Teaches the promote and claim functions about the customer audience.
--
-- Every safety rule that applies to a business contact applies here too, against the
-- equivalent columns on customers: eligibility, the do-not-contact register, the global
-- suppression list, the frequency cap and the contact-row lock that makes the cap hold across
-- two campaigns. The differences are only where the two populations genuinely differ.
--
-- Guests are individuals, so the eligibility test is the soft opt-in rather than a reviewer's
-- decision: an address we obtained while they booked, for marketing about the same kind of
-- thing, with an opt-out in every message. A customer with no booking has no basis and is not
-- selected. An explicit opt-in (marketing_email_opt_in) also qualifies on its own.

BEGIN;

CREATE OR REPLACE FUNCTION public.promote_due_marketing_campaigns()
RETURNS TABLE (promoted_campaign_id uuid, promoted_recipients integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_include text[];
  v_exclude text[];
  v_added integer;
BEGIN
  IF NOT public.marketing_send_window_open() THEN
    RETURN;
  END IF;

  FOR v_campaign IN
    SELECT * FROM public.marketing_campaigns
    WHERE status = 'scheduled' AND scheduled_for <= now()
    ORDER BY scheduled_for
    FOR UPDATE SKIP LOCKED
  LOOP
    v_include := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'include_tags')), '{}'::text[]);
    v_exclude := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'exclude_tags')), '{}'::text[]);

    IF v_campaign.audience_type = 'customer' THEN
      -- Guests. Tags do not exist on customers, so the audience is the whole eligible
      -- population; the eligibility test itself is what narrows it.
      INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, customer_id, email)
      SELECT v_campaign.id, c.id, lower(btrim(c.email))
      FROM public.customers c
      WHERE c.email IS NOT NULL AND btrim(c.email) <> ''
        AND c.marketing_email_opted_out_at IS NULL
        AND COALESCE(c.email_status, 'unknown') <> 'bounced'
        AND (
          c.marketing_email_opt_in IS TRUE
          OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = c.id)
          OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = c.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_do_not_contact d
          WHERE d.email_normalised = lower(btrim(c.email)) AND d.removed_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(btrim(c.email)))
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, contact_id, email)
      SELECT v_campaign.id, bc.id, bc.email
      FROM public.business_contacts bc
      WHERE bc.eligibility_status = 'eligible'
        AND bc.marketing_status = 'subscribed'
        AND (cardinality(v_include) = 0 OR bc.tags && v_include)
        AND (cardinality(v_exclude) = 0 OR NOT (bc.tags && v_exclude))
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_do_not_contact d
          WHERE d.email_normalised = bc.email AND d.removed_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = bc.email)
      ON CONFLICT DO NOTHING;
    END IF;

    GET DIAGNOSTICS v_added = ROW_COUNT;

    UPDATE public.marketing_campaigns
       SET status = CASE WHEN v_added = 0 THEN 'completed' ELSE 'sending' END,
           started_at = now(),
           completed_at = CASE WHEN v_added = 0 THEN now() ELSE NULL END
     WHERE id = v_campaign.id;

    promoted_campaign_id := v_campaign.id;
    promoted_recipients := v_added;
    RETURN NEXT;
  END LOOP;
END;
$$;

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
  IF NOT public.marketing_send_window_open() THEN RETURN; END IF;

  FOR v_candidate IN
    SELECT r.id AS recipient_id, r.contact_id, r.customer_id, r.failure_class, r.last_attempt_at
    FROM public.marketing_campaign_recipients r
    JOIN public.marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.status = 'pending'
      AND c.status = 'sending'
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    ORDER BY r.created_at
    LIMIT GREATEST(p_batch * 4, 20)
  LOOP
    EXIT WHEN v_claimed >= p_batch;

    -- Past the provider's idempotency window a resend could genuinely duplicate, so a
    -- recovered attempt of unknown outcome goes to a human instead.
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
        -- The soft opt-in basis has gone, so there is no lawful ground left.
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

    -- Rules that apply to both populations, checked against whichever row we just locked.
    IF v_skip IS NULL AND EXISTS (
      SELECT 1 FROM public.marketing_do_not_contact d
      WHERE d.email_normalised = v_email AND d.removed_at IS NULL
    ) THEN
      v_skip := 'do_not_contact';
    END IF;

    IF v_skip IS NULL AND v_settings.frequency_cap_days > 0
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

  IF v_recipient.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET marketing_last_email_at = now(),
           marketing_last_campaign_id = v_recipient.campaign_id,
           marketing_reserved_until = NULL
     WHERE id = v_recipient.customer_id;
  ELSE
    UPDATE public.business_contacts
       SET last_marketing_email_at = now(),
           last_marketing_campaign_id = v_recipient.campaign_id,
           marketing_reserved_until = NULL
     WHERE id = v_recipient.contact_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_marketing_claim(
  p_recipient_id uuid,
  p_failure_class text,
  p_error text,
  p_backoff_seconds integer DEFAULT 300
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recipient public.marketing_campaign_recipients%ROWTYPE;
BEGIN
  SELECT * INTO v_recipient FROM public.marketing_campaign_recipients WHERE id = p_recipient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_marketing_claim: recipient % not found', p_recipient_id;
  END IF;

  UPDATE public.marketing_campaign_recipients
     SET status = CASE
           WHEN p_failure_class = 'terminal' THEN 'failed'
           WHEN v_recipient.attempt_count >= v_recipient.max_attempts THEN 'failed'
           ELSE 'pending' END,
         failure_class = p_failure_class,
         error = left(COALESCE(p_error, ''), 2000),
         claimed_at = NULL,
         lease_expires_at = NULL,
         next_attempt_at = now() + make_interval(secs => GREATEST(p_backoff_seconds, 0))
   WHERE id = p_recipient_id;

  -- Nothing was sent, so neither population should be held against the cap.
  IF v_recipient.customer_id IS NOT NULL THEN
    UPDATE public.customers SET marketing_reserved_until = NULL WHERE id = v_recipient.customer_id;
  ELSE
    UPDATE public.business_contacts SET marketing_reserved_until = NULL WHERE id = v_recipient.contact_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_due_marketing_campaigns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_marketing_recipients(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalise_marketing_send(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_marketing_claim(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_due_marketing_campaigns() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_marketing_recipients(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalise_marketing_send(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_marketing_claim(uuid, text, text, integer) TO service_role;

COMMIT;
