-- Marketing conversions: enquiries that a campaign produced.
--
-- Why this table exists at all:
--
-- * Bookings already land in analytics_events carrying the utm_* values the website
--   forwarded, so a campaign that produces a table booking or an event booking is already
--   measurable. An ENQUIRY is not. /christmas-parties is the main call to action of the
--   first B2B campaign and its form only ever produced an email, so the click was tracked
--   and the result was invisible.
--
-- * analytics_events cannot hold these. Its customer_id is NOT NULL and an enquiry has no
--   customer: the enquirer is a business that has not booked anything yet. Forcing one in
--   would mean inventing a consumer customer record for every business that asks a
--   question, which pollutes the customer list and the SMS marketing audience with people
--   who never consented to either.
--
-- * campaign_id / recipient_id / business_contact_id are resolved at write time from
--   utm_content, which the renderer stamps with the recipient id. That is what turns an
--   anonymous conversion into "this named business enquired". They stay nullable on
--   purpose: a forwarded email, a shared link or an organic visit all produce a real
--   conversion with nothing to resolve, and dropping those would understate the campaign.

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  conversion_type text NOT NULL
    CHECK (conversion_type IN ('christmas_enquiry', 'private_booking_enquiry', 'contact_form', 'other')),
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- Attribution exactly as the website captured it, unparsed. Stored raw so a later change
  -- to how campaigns are named cannot retrospectively rewrite what a visitor arrived with.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  short_code text,
  landing_path text,
  source_url text,

  -- Loose context about the enquiry, never PII beyond what the venue already receives by
  -- email. No name, no email address, no phone number: those live in the enquiry itself,
  -- and an analytics table is the wrong place to accumulate a second copy of them.
  company_name text,
  party_size integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Set when utm_content resolves to a real campaign recipient.
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES public.marketing_campaign_recipients(id) ON DELETE SET NULL,
  business_contact_id uuid REFERENCES public.business_contacts(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_conversions_party_size_sane
    CHECK (party_size IS NULL OR (party_size > 0 AND party_size <= 10000))
);

-- Campaign reporting reads by UTM value over a period, newest first.
CREATE INDEX IF NOT EXISTS marketing_conversions_campaign_idx
  ON public.marketing_conversions (utm_campaign, occurred_at DESC);

-- Per-recipient and per-contact reporting: "did this named business respond".
CREATE INDEX IF NOT EXISTS marketing_conversions_recipient_idx
  ON public.marketing_conversions (recipient_id)
  WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_conversions_contact_idx
  ON public.marketing_conversions (business_contact_id)
  WHERE business_contact_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Access: service-role only, matching the rest of the marketing tables. The write path is
-- an API-key endpoint and every read goes through a server action that checks RBAC first,
-- so no signed-in browser session needs direct access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.marketing_conversions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_conversions FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.marketing_conversions TO service_role;

COMMIT;
