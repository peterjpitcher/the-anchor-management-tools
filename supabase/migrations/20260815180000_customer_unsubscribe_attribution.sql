-- Lets a guest unsubscribe be attributed to the campaign that caused it.
--
-- business_contacts has carried `unsubscribe_campaign_id` since the first marketing migration,
-- and campaign stats count it. customers never had the equivalent, so the unsubscribe rate on
-- every guest campaign reads 0.0% no matter how many people actually opt out. The opt-out
-- itself has always worked; it is only the attribution that was missing.
--
-- That matters beyond curiosity: the unsubscribe rate is the main signal that a campaign
-- annoyed people, and a number hard-wired to zero is worse than no number, because it reads
-- as evidence that nobody minded.

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_unsubscribe_campaign_id uuid
    REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.customers.marketing_unsubscribe_campaign_id IS
  'The campaign a guest was reading when they opted out, where known. Set once and never '
  'rewritten: the first objection is the one that counts. Mirrors '
  'business_contacts.unsubscribe_campaign_id.';

-- Partial: the overwhelming majority of customers have never unsubscribed, and the only query
-- is "which opt-outs belong to this campaign".
CREATE INDEX IF NOT EXISTS customers_marketing_unsubscribe_campaign_idx
  ON public.customers (marketing_unsubscribe_campaign_id)
  WHERE marketing_unsubscribe_campaign_id IS NOT NULL;

COMMIT;
