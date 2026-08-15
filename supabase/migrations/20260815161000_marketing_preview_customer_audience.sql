-- Makes the scheduled-recipient count truthful for guest campaigns.
--
-- previewAudience() only ever counted business_contacts, so scheduling a guest campaign stored
-- and displayed the business figure. Nothing was mis-sent, because promote_due_marketing_campaigns()
-- branches on audience_type and picks the right people, but the screen the owner checks before a
-- send said 155 for an email going to roughly 239. A count nobody can trust is worse than no count.
--
-- The predicates below are a deliberate copy of the customer branch of the promote RPC. Keeping
-- them in SQL next to that RPC is the point: a preview computed a different way in TypeScript is
-- exactly how a preview drifts away from the thing it claims to predict.

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_customer_marketing_audience()
RETURNS TABLE (
  eligible_count integer,
  not_eligible_count integer,
  unsubscribed_count integer,
  do_not_contact_count integer,
  suppressed_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH classified AS (
    SELECT CASE
      WHEN c.email IS NULL OR btrim(c.email) = '' THEN 'not_eligible'
      WHEN c.marketing_email_opted_out_at IS NOT NULL THEN 'unsubscribed'
      WHEN COALESCE(c.email_status, 'unknown') = 'bounced' THEN 'suppressed'
      WHEN EXISTS (
        SELECT 1 FROM public.email_suppressions es
        WHERE lower(es.email) = lower(btrim(c.email))
      ) THEN 'suppressed'
      WHEN EXISTS (
        SELECT 1 FROM public.marketing_do_not_contact d
        WHERE d.email_normalised = lower(btrim(c.email)) AND d.removed_at IS NULL
      ) THEN 'do_not_contact'
      WHEN NOT (
        c.marketing_email_opt_in IS TRUE
        OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = c.id)
        OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = c.id)
      ) THEN 'not_eligible'
      ELSE 'eligible'
    END AS bucket
    FROM public.customers c
  )
  SELECT
    count(*) FILTER (WHERE bucket = 'eligible')::integer,
    count(*) FILTER (WHERE bucket = 'not_eligible')::integer,
    count(*) FILTER (WHERE bucket = 'unsubscribed')::integer,
    count(*) FILTER (WHERE bucket = 'do_not_contact')::integer,
    count(*) FILTER (WHERE bucket = 'suppressed')::integer
  FROM classified;
$$;

COMMENT ON FUNCTION public.preview_customer_marketing_audience() IS
  'Counts for a guest campaign, mirroring the customer branch of promote_due_marketing_campaigns(). '
  'Change both together or the preview stops predicting the send.';

REVOKE ALL ON FUNCTION public.preview_customer_marketing_audience() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_customer_marketing_audience() TO service_role;

COMMIT;
