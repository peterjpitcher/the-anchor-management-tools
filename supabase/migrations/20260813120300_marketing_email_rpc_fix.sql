-- Fixes a name collision in promote_due_marketing_campaigns().
--
-- The function declared RETURNS TABLE (campaign_id uuid, ...), which creates a PL/pgSQL
-- variable called campaign_id. The insert below references the marketing_campaign_recipients
-- column of the same name, so Postgres could not tell which one was meant and raised
-- "column reference campaign_id is ambiguous" at runtime, in the ON CONFLICT clause.
--
-- Nothing catches this at CREATE FUNCTION time: a plpgsql body is only fully resolved when it
-- executes, so it would have failed on the first real campaign promotion. The output columns
-- are renamed to keep them clear of every column name the body touches.

BEGIN;

DROP FUNCTION IF EXISTS public.promote_due_marketing_campaigns();

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
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'include_tags')),
      '{}'::text[]
    );
    v_exclude := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'exclude_tags')),
      '{}'::text[]
    );

    -- Include tags match on ANY (overlap). An empty include list means every eligible
    -- contact. Exclude tags remove a contact on any single match.
    INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, contact_id, email)
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

    promoted_campaign_id := v_campaign.id;
    promoted_recipients := v_added;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_due_marketing_campaigns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_due_marketing_campaigns() TO service_role;

COMMIT;
