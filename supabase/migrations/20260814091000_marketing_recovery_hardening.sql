-- Closes two ways a recovered send could reach a recipient twice.
--
-- Both were found by an adversarial review before the first real campaign, and both need the
-- database rather than the application, because the application is exactly what has already
-- died when these paths run.
--
-- FAULT 1: the idempotency window was checked at the wrong moment.
--
-- recover_stale_marketing_claims quarantined a stale attempt only if more than 24 hours had
-- already passed, and otherwise returned the row to 'pending' so it could retry safely under
-- the provider's idempotency key. But 'pending' is not 'sent soon': the kill switch, a paused
-- campaign, the send window, or simply a weekend can hold that row for days. By the time it
-- was finally claimed the key had long expired, and the provider would treat it as a fresh
-- send. A single killed function turned into a real business receiving the same email twice.
-- The check now also happens at claim time, which is the only moment that actually matters.
--
-- FAULT 2: proof of sending was read from the wrong column.
--
-- Recovery treated marketing_campaign_recipients.email_message_id as proof the email went
-- out. That column is written by finalise_marketing_send, so keying off it alone misses
-- precisely the case where finalise_marketing_send is what failed. Such a row was returned to
-- 'pending' with the contact's frequency cap never advanced, so a second campaign could mail
-- the same contact the same day, inside the seven-day cap the design promises. Proof now
-- comes from email_messages, which the send path writes independently, and the contact half
-- of finalisation is applied late so the cap moves even when the original finalise failed.

BEGIN;

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
  -- Proof of a send is an email_messages row for this recipient, NOT the recipient's own
  -- email_message_id: that column is only written by finalise_marketing_send, so relying on
  -- it misses the case where finalise itself is what failed.
  WITH already_sent AS (
    UPDATE public.marketing_campaign_recipients r
       SET status = 'sent',
           sent_at = COALESCE(r.sent_at, now()),
           lease_expires_at = NULL,
           email_message_id = COALESCE(
             r.email_message_id,
             (SELECT em.id FROM public.email_messages em
               WHERE em.marketing_recipient_id = r.id AND em.sent_at IS NOT NULL
               ORDER BY em.created_at LIMIT 1)
           )
     WHERE r.status = 'sending'
       AND r.lease_expires_at < now()
       AND (
         r.email_message_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM public.email_messages em
           WHERE em.marketing_recipient_id = r.id AND em.sent_at IS NOT NULL
         )
       )
    RETURNING r.contact_id, r.campaign_id
  ),
  -- The contact half of finalise_marketing_send, applied late. Without this the frequency cap
  -- stays unset for somebody who already has the email in their inbox.
  cap AS (
    UPDATE public.business_contacts bc
       SET last_marketing_email_at = COALESCE(bc.last_marketing_email_at, now()),
           last_marketing_campaign_id = COALESCE(bc.last_marketing_campaign_id, a.campaign_id),
           marketing_reserved_until = NULL
      FROM already_sent a
     WHERE bc.id = a.contact_id
    RETURNING 1
  )
  SELECT count(*) INTO v_recovered FROM already_sent;

  -- Already past the provider's idempotency retention, so a retry could genuinely duplicate.
  WITH stale AS (
    UPDATE public.marketing_campaign_recipients r
       SET status = 'needs_review',
           failure_class = 'unknown',
           lease_expires_at = NULL,
           error = 'Lease expired more than 24 hours after the attempt; cannot prove whether the provider accepted it'
     WHERE r.status = 'sending'
       AND r.lease_expires_at < now()
       AND r.last_attempt_at < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*) INTO v_quarantined FROM stale;

  -- Inside the window a retry with the same idempotency key is safe. The row is marked
  -- 'unknown' so the claim step can tell it apart from a never-attempted row and re-check the
  -- window at the moment it actually matters.
  UPDATE public.marketing_campaign_recipients r
     SET status = 'pending',
         failure_class = 'unknown',
         claimed_at = NULL,
         lease_expires_at = NULL,
         next_attempt_at = now()
   WHERE r.status = 'sending'
     AND r.lease_expires_at < now();

  UPDATE public.business_contacts bc
     SET marketing_reserved_until = NULL
   WHERE bc.marketing_reserved_until IS NOT NULL
     AND bc.marketing_reserved_until < now();

  recovered := v_recovered;
  quarantined := v_quarantined;
  RETURN NEXT;
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
    SELECT r.id AS recipient_id, r.contact_id, r.failure_class, r.last_attempt_at
    FROM public.marketing_campaign_recipients r
    JOIN public.marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.status = 'pending'
      AND c.status = 'sending'
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    ORDER BY r.created_at
    LIMIT GREATEST(p_batch * 4, 20)
  LOOP
    EXIT WHEN v_claimed >= p_batch;

    -- A row recovery reset after an attempt whose outcome we could not prove is only safe to
    -- resend while the provider still deduplicates on the idempotency key. A pause, the kill
    -- switch, the send window or a weekend can hold it well past that, so the window is
    -- re-checked HERE, at the moment of sending, not only when it was recovered.
    IF v_candidate.failure_class = 'unknown'
       AND v_candidate.last_attempt_at IS NOT NULL
       AND v_candidate.last_attempt_at < now() - interval '24 hours' THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'needs_review',
             error = 'Recovered from an attempt whose outcome could not be proved, and the provider idempotency window has since closed'
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

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

REVOKE ALL ON FUNCTION public.recover_stale_marketing_claims() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_marketing_recipients(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_marketing_claims() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_marketing_recipients(integer) TO service_role;

COMMIT;
