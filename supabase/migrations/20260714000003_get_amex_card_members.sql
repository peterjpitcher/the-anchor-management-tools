-- FF-012: distinct Amex card members for the receipts cardholder filter, computed in
-- the database (uses the partial index on card_member WHERE source_type='amex')
-- instead of fetching up to 2000 Amex rows and de-duplicating in application code.

CREATE OR REPLACE FUNCTION public.get_amex_card_members()
RETURNS TABLE (card_member text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rt.card_member
  FROM public.receipt_transactions rt
  WHERE rt.source_type = 'amex'
    AND rt.card_member IS NOT NULL
  ORDER BY rt.card_member
$$;

-- Called only from the service layer via the service-role admin client. New functions
-- get EXECUTE granted to PUBLIC (anon + authenticated) by default, so lock it down.
REVOKE EXECUTE ON FUNCTION public.get_amex_card_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_amex_card_members() TO service_role;
