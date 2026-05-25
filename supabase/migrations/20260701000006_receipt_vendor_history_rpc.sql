CREATE OR REPLACE FUNCTION public.get_receipt_vendor_transactions(target_vendor_label TEXT)
RETURNS TABLE (
  id UUID,
  transaction_date DATE,
  details TEXT,
  amount_in NUMERIC(12, 2),
  amount_out NUMERIC(12, 2),
  status TEXT,
  vendor_name TEXT,
  vendor_source TEXT,
  transaction_type TEXT,
  expense_category TEXT,
  expense_category_source TEXT
) AS $$
  WITH target AS (
    SELECT LOWER(REGEXP_REPLACE(BTRIM(target_vendor_label), '[[:space:]]+', ' ', 'g')) AS vendor_key
  ), source AS (
    SELECT
      rt.id,
      rt.transaction_date,
      rt.details,
      rt.amount_in,
      rt.amount_out,
      rt.status::TEXT AS status,
      COALESCE(NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS canonical_vendor_name,
      rt.vendor_source,
      rt.transaction_type,
      rt.expense_category,
      rt.expense_category_source,
      rt.created_at
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  )
  SELECT
    source.id,
    source.transaction_date,
    source.details,
    source.amount_in,
    source.amount_out,
    source.status,
    source.canonical_vendor_name AS vendor_name,
    source.vendor_source,
    source.transaction_type,
    source.expense_category,
    source.expense_category_source
  FROM source
  CROSS JOIN target
  WHERE target.vendor_key <> ''
    AND source.canonical_vendor_name IS NOT NULL
    AND LOWER(REGEXP_REPLACE(source.canonical_vendor_name, '[[:space:]]+', ' ', 'g')) = target.vendor_key
  ORDER BY source.transaction_date DESC, source.created_at DESC, source.id DESC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_receipt_vendor_transactions(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_transactions(TEXT) TO service_role;
