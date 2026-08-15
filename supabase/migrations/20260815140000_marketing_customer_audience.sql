-- Lets a marketing campaign send to consumer customers as well as business contacts.
--
-- The two audiences stay in separate tables on purpose, and this does not change that. A
-- campaign now declares which audience it is for, and a recipient row points at exactly one
-- of them. Merging consumers into business_contacts would have been quicker and wrong: the
-- lawful basis is different (a business contact is a corporate subscriber, a guest is an
-- individual who needs consent or a satisfied soft opt-in), the consent columns already exist
-- on customers, and erasure treats the two differently.
--
-- Soft opt-in is the basis for guests, so the audience is restricted to customers who have
-- actually booked with us. Somebody whose address we hold without a booking has no basis and
-- is deliberately excluded, which is 34 of the 276 addresses on file at the time of writing.

BEGIN;

-- ---------------------------------------------------------------------------
-- Campaigns declare their audience
-- ---------------------------------------------------------------------------

ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS audience_type text NOT NULL DEFAULT 'business'
    CHECK (audience_type IN ('business', 'customer'));

COMMENT ON COLUMN public.marketing_campaigns.audience_type IS
  'Which population the audience is drawn from. business = business_contacts (corporate '
  'subscribers, legitimate interest). customer = customers (individuals, soft opt-in, so '
  'restricted to those who have booked).';

-- ---------------------------------------------------------------------------
-- Customers gain the same send-state columns business contacts already have
-- ---------------------------------------------------------------------------

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_last_email_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_reserved_until timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_last_campaign_id uuid
    REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.customers.marketing_reserved_until IS
  'Held across the provider call so two campaigns cannot both send to this guest inside the '
  'frequency cap. Mirrors business_contacts.marketing_reserved_until.';

-- ---------------------------------------------------------------------------
-- A recipient is either a business contact or a customer, never both
-- ---------------------------------------------------------------------------

ALTER TABLE public.marketing_campaign_recipients
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.marketing_campaign_recipients
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE public.marketing_campaign_recipients
  DROP CONSTRAINT IF EXISTS mcr_one_subject;
ALTER TABLE public.marketing_campaign_recipients
  ADD CONSTRAINT mcr_one_subject
  CHECK ((contact_id IS NULL) <> (customer_id IS NULL));

-- The old table-level unique covered (campaign_id, contact_id). With contact_id nullable it
-- still works for business rows, because NULLs are distinct, but customers need their own.
CREATE UNIQUE INDEX IF NOT EXISTS mcr_campaign_customer_key
  ON public.marketing_campaign_recipients (campaign_id, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcr_customer_idx
  ON public.marketing_campaign_recipients (customer_id) WHERE customer_id IS NOT NULL;

-- email_messages can already point at a customer via customer_id, so nothing to add there.

COMMIT;
