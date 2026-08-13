-- B2B marketing email: lifecycle and queue functions.
--
-- Everything that changes campaign state and recipient state together lives here, in one
-- transaction each. Doing it from the application in two steps is what would let a crash
-- leave a campaign marked as sending with no recipients, which the completion sweep would
-- then mark as finished without sending anything.
--
-- The frequency cap is enforced by locking the CONTACT row, not the recipient row. Two
-- campaigns due in the same window both have their own recipient row for the same contact,
-- so locking recipients would let both through.

BEGIN;

-- ---------------------------------------------------------------------------
-- Send window
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marketing_send_window_open()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT
        EXTRACT(ISODOW FROM timezone('Europe/London', now()))::smallint = ANY (s.send_days)
        AND EXTRACT(HOUR FROM timezone('Europe/London', now()))::integer >= s.send_window_start_hour
        AND EXTRACT(HOUR FROM timezone('Europe/London', now()))::integer < s.send_window_end_hour
      FROM public.marketing_settings s
      WHERE s.id
      LIMIT 1
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Promote due campaigns and snapshot their audience, atomically
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.promote_due_marketing_campaigns()
RETURNS TABLE (campaign_id uuid, recipients_added integer)
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
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'include_tags')),
      '{}'::text[]
    );
    v_exclude := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'exclude_tags')),
      '{}'::text[]
    );

    -- Include tags match on ANY (overlap). An empty include list means every eligible
    -- contact. Exclude tags remove a contact on any single match.
    INSERT INTO public.marketing_campaign_recipients (campaign_id, contact_id, email)
    SELECT v_campaign.id, bc.id, bc.email
    FROM public.business_contacts bc
    WHERE bc.eligibility_status = 'eligible'
      AND bc.marketing_status = 'subscribed'
      AND (cardinality(v_include) = 0 OR bc.tags && v_include)
      AND (cardinality(v_exclude) = 0 OR NOT (bc.tags && v_exclude))
      AND NOT EXISTS (
        SELECT 1 FROM public.marketing_do_not_contact d
        WHERE d.email_normalised = bc.email AND d.removed_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = bc.email
      )
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;

    GET DIAGNOSTICS v_added = ROW_COUNT;

    UPDATE public.marketing_campaigns
       SET status = CASE WHEN v_added = 0 THEN 'completed' ELSE 'sending' END,
           started_at = now(),
           completed_at = CASE WHEN v_added = 0 THEN now() ELSE NULL END
     WHERE id = v_campaign.id;

    campaign_id := v_campaign.id;
    recipients_added := v_added;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Claim a batch. Reserves the contact so the frequency cap holds across campaigns.
-- ---------------------------------------------------------------------------

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
  v_row public.marketing_campaign_recipients%ROWTYPE;
  v_claimed integer := 0;
  v_lease interval := interval '10 minutes';
  v_skip text;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 200 THEN
    RAISE EXCEPTION 'claim_marketing_recipients: p_batch must be between 1 and 200, got %', p_batch;
  END IF;

  SELECT * INTO v_settings FROM public.marketing_settings WHERE id LIMIT 1;
  IF NOT FOUND OR NOT v_settings.sends_enabled THEN
    RETURN;
  END IF;

  IF NOT public.marketing_send_window_open() THEN
    RETURN;
  END IF;

  FOR v_candidate IN
    SELECT r.id AS recipient_id, r.contact_id
    FROM public.marketing_campaign_recipients r
    JOIN public.marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.status = 'pending'
      AND c.status = 'sending'
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    ORDER BY r.created_at
    LIMIT GREATEST(p_batch * 4, 20)
  LOOP
    EXIT WHEN v_claimed >= p_batch;

    -- SKIP LOCKED: if a concurrent run already holds this contact we move on rather than
    -- wait, which is exactly what stops two campaigns sending to one contact at once.
    SELECT * INTO v_contact
    FROM public.business_contacts
    WHERE id = v_candidate.contact_id
    FOR UPDATE SKIP LOCKED;

    CONTINUE WHEN NOT FOUND;

    -- Re-check every rule under the lock. The snapshot may be days old by now.
    v_skip := NULL;
    IF v_contact.eligibility_status <> 'eligible' THEN
      v_skip := 'not_eligible';
    ELSIF v_contact.marketing_status <> 'subscribed' THEN
      v_skip := 'unsubscribed';
    ELSIF EXISTS (
      SELECT 1 FROM public.marketing_do_not_contact d
      WHERE d.email_normalised = v_contact.email AND d.removed_at IS NULL
    ) THEN
      v_skip := 'do_not_contact';
    ELSIF v_settings.frequency_cap_days > 0
      AND v_contact.last_marketing_email_at IS NOT NULL
      AND v_contact.last_marketing_email_at > now() - make_interval(days => v_settings.frequency_cap_days)
    THEN
      v_skip := 'frequency_cap';
    END IF;

    IF v_skip IS NOT NULL THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'skipped', skip_reason = v_skip
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    -- Another run holds an unexpired reservation on this contact.
    CONTINUE WHEN v_contact.marketing_reserved_until IS NOT NULL
              AND v_contact.marketing_reserved_until > now();

    UPDATE public.business_contacts
       SET marketing_reserved_until = now() + v_lease
     WHERE id = v_contact.id;

    UPDATE public.marketing_campaign_recipients
       SET status = 'sending',
           claimed_at = now(),
           lease_expires_at = now() + v_lease,
           attempt_count = attempt_count + 1,
           last_attempt_at = now()
     WHERE id = v_candidate.recipient_id
       AND status = 'pending'
    RETURNING * INTO v_row;

    CONTINUE WHEN NOT FOUND;

    v_claimed := v_claimed + 1;
    RETURN NEXT v_row;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Finalise one send: recipient, contact and reservation move together
-- ---------------------------------------------------------------------------

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

  -- The send happened, so the cap starts now and the reservation is released.
  UPDATE public.business_contacts
     SET last_marketing_email_at = now(),
         last_marketing_campaign_id = v_recipient.campaign_id,
         marketing_reserved_until = NULL
   WHERE id = v_recipient.contact_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Release a claim that did not send
-- ---------------------------------------------------------------------------

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
  SELECT * INTO v_recipient
  FROM public.marketing_campaign_recipients WHERE id = p_recipient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_marketing_claim: recipient % not found', p_recipient_id;
  END IF;

  UPDATE public.marketing_campaign_recipients
     SET status = CASE
           WHEN p_failure_class = 'terminal' THEN 'failed'
           WHEN v_recipient.attempt_count >= v_recipient.max_attempts THEN 'failed'
           ELSE 'pending'
         END,
         failure_class = p_failure_class,
         error = left(COALESCE(p_error, ''), 2000),
         claimed_at = NULL,
         lease_expires_at = NULL,
         next_attempt_at = now() + make_interval(secs => GREATEST(p_backoff_seconds, 0))
   WHERE id = p_recipient_id;

  -- Nothing was sent, so the contact must not be held against the cap.
  UPDATE public.business_contacts
     SET marketing_reserved_until = NULL
   WHERE id = v_recipient.contact_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Recover leases that expired because a run died mid-batch
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recover_stale_marketing_claims()
RETURNS TABLE (recovered integer, quarantined integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recovered integer := 0;
  v_quarantined integer := 0;
BEGIN
  -- A row whose email_messages link already exists did send; the crash was after the
  -- provider call. Finish it rather than sending twice.
  WITH already_sent AS (
    UPDATE public.marketing_campaign_recipients r
       SET status = 'sent', sent_at = COALESCE(r.sent_at, now()), lease_expires_at = NULL
     WHERE r.status = 'sending'
       AND r.lease_expires_at < now()
       AND r.email_message_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_recovered FROM already_sent;

  -- Beyond the provider's idempotency retention a retry could genuinely duplicate, so the
  -- row goes to a human instead of being resent on a guess.
  WITH stale AS (
    UPDATE public.marketing_campaign_recipients r
       SET status = 'needs_review',
           failure_class = 'unknown',
           lease_expires_at = NULL,
           error = 'Lease expired more than 24 hours after the attempt; cannot prove whether the provider accepted it'
     WHERE r.status = 'sending'
       AND r.lease_expires_at < now()
       AND r.email_message_id IS NULL
       AND r.last_attempt_at < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*) INTO v_quarantined FROM stale;

  -- Inside the idempotency window a retry with the same key is safe.
  UPDATE public.marketing_campaign_recipients r
     SET status = 'pending', claimed_at = NULL, lease_expires_at = NULL, next_attempt_at = now()
   WHERE r.status = 'sending'
     AND r.lease_expires_at < now()
     AND r.email_message_id IS NULL;

  UPDATE public.business_contacts bc
     SET marketing_reserved_until = NULL
   WHERE bc.marketing_reserved_until IS NOT NULL
     AND bc.marketing_reserved_until < now();

  recovered := v_recovered;
  quarantined := v_quarantined;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cancel: campaign and its unstarted queue move together
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_marketing_campaign(p_campaign_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cancelled integer;
BEGIN
  UPDATE public.marketing_campaigns
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_user_id
   WHERE id = p_campaign_id
     AND status IN ('draft', 'scheduled', 'sending', 'paused');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_marketing_campaign: campaign % is not in a cancellable state', p_campaign_id;
  END IF;

  -- Rows already claimed are left alone: one provider call may be in flight and marking it
  -- skipped would lose the record of a real send.
  UPDATE public.marketing_campaign_recipients
     SET status = 'skipped', skip_reason = 'campaign_cancelled'
   WHERE campaign_id = p_campaign_id
     AND status = 'pending';

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RETURN v_cancelled;
END;
$$;

-- ---------------------------------------------------------------------------
-- Completion sweep
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_finished_marketing_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_completed integer;
BEGIN
  UPDATE public.marketing_campaigns c
     SET status = 'completed', completed_at = now()
   WHERE c.status = 'sending'
     AND NOT EXISTS (
       SELECT 1 FROM public.marketing_campaign_recipients r
       WHERE r.campaign_id = c.id AND r.status IN ('pending', 'sending')
     );

  GET DIAGNOSTICS v_completed = ROW_COUNT;
  RETURN v_completed;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Revoking from PUBLIC alone is not enough: a grant made to a named role
-- survives it, so anon and authenticated are revoked explicitly too.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.marketing_send_window_open() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_due_marketing_campaigns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_marketing_recipients(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalise_marketing_send(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_marketing_claim(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_stale_marketing_claims() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_marketing_campaign(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_finished_marketing_campaigns() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.marketing_send_window_open() TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_due_marketing_campaigns() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_marketing_recipients(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalise_marketing_send(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_marketing_claim(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_marketing_claims() TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_marketing_campaign(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_finished_marketing_campaigns() TO service_role;

COMMIT;
