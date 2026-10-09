-- Stops an event email going to a guest who has already booked that event.
--
-- The owner's decision, 9 October 2026. A regular booked eight seats for Music Bingo by text
-- at 09:53 and was emailed "Reserve your bingo seats" for the same night at 12:10. Nothing
-- was broken: a campaign had no idea which event it promoted, so the send could not know
-- who was already coming.
--
-- THREE PARTS.
--   1. `marketing_campaigns.event_id`: the one event a campaign promotes, or NULL. The app
--      fills it when a campaign is scheduled, from the event page the email links to, and
--      only when the email links to exactly one event. A monthly round-up links to several
--      and stays NULL, so it is never thinned by this rule.
--   2. A new skip reason, `already_booked`, so the campaign report says why somebody was
--      left out instead of folding them into another reason.
--   3. `claim_marketing_recipients` checks for a live booking as it claims each recipient.
--      That is where every other skip is decided, and deciding it at send time means a
--      booking made after the campaign was scheduled still counts.
--
-- "Already booked" means any booking for that event that is not cancelled or expired.
--
-- The backfill links campaigns that are still to send (draft, scheduled, sending, paused)
-- using the same exactly-one-event test the app applies. Finished campaigns are left alone.
--
-- Rollback: set `event_id` to NULL on a campaign and the rule no longer applies to it. To
-- remove it everywhere, re-run the function definition from
-- 20260909084500_marketing_monthly_roundup_cap_exempt.sql.

BEGIN;

ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.marketing_campaigns.event_id IS
  'The single event this campaign promotes, or NULL (round-ups and non-event campaigns). '
  'Set at scheduling from the event page the email links to. A guest who already holds a '
  'booking for it is skipped with already_booked when the campaign sends.';

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_event_id
  ON public.marketing_campaigns (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE public.marketing_campaign_recipients
  DROP CONSTRAINT IF EXISTS marketing_campaign_recipients_skip_reason_check;
ALTER TABLE public.marketing_campaign_recipients
  ADD CONSTRAINT marketing_campaign_recipients_skip_reason_check CHECK (
    skip_reason IS NULL OR skip_reason = ANY (ARRAY[
      'unsubscribed', 'suppressed', 'do_not_contact', 'frequency_cap',
      'not_eligible', 'campaign_cancelled', 'already_booked'
    ])
  );

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
           c.ignores_frequency_cap, c.event_id
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

    -- The only change from the previous definition: a guest who already holds seats for the
    -- event this campaign promotes is not asked to book it. Read here, at the moment of
    -- sending, so a booking made minutes earlier counts. Business contacts have no bookings
    -- of their own and are never skipped by this.
    IF v_skip IS NULL
       AND v_candidate.customer_id IS NOT NULL
       AND v_candidate.event_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.bookings b
          WHERE b.event_id = v_candidate.event_id
            AND b.customer_id = v_candidate.customer_id
            AND b.status NOT IN ('cancelled', 'expired')
       ) THEN
      v_skip := 'already_booked';
    END IF;

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

REVOKE ALL ON FUNCTION public.claim_marketing_recipients(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_recipients(integer) TO service_role;

-- Backfill: campaigns still to send that link to exactly one event page.
WITH matches AS (
  SELECT c.id AS campaign_id, e.id AS event_id
    FROM public.marketing_campaigns c
    CROSS JOIN LATERAL jsonb_object_keys(COALESCE(c.link_map, '{}'::jsonb)) AS k(url)
    JOIN public.events e
      ON e.slug IS NOT NULL
     AND e.slug = substring(k.url FROM '^https?://[^/]+/events/([^/?#]+)')
   WHERE c.status IN ('draft', 'scheduled', 'sending', 'paused')
     AND c.event_id IS NULL
   GROUP BY c.id, e.id
),
single AS (
  SELECT campaign_id, (array_agg(event_id))[1] AS event_id
    FROM matches GROUP BY campaign_id HAVING count(*) = 1
)
UPDATE public.marketing_campaigns c
   SET event_id = s.event_id
  FROM single s
 WHERE c.id = s.campaign_id;

COMMIT;
