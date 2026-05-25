CREATE OR REPLACE FUNCTION public.get_receipt_vendor_monthly_totals(range_months INTEGER DEFAULT NULL)
RETURNS TABLE (
  vendor_key TEXT,
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH source AS (
    SELECT
      rt.transaction_date,
      COALESCE(NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS vendor_value,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  ), canonical AS (
    SELECT
      LOWER(REGEXP_REPLACE(vendor_value, '[[:space:]]+', ' ', 'g')) AS vendor_key,
      vendor_value,
      DATE_TRUNC('month', transaction_date)::DATE AS month_start,
      amount_out,
      amount_in
    FROM source
    WHERE vendor_value IS NOT NULL
  ), bounds AS (
    SELECT MAX(month_start) AS latest_month
    FROM canonical
  ), filtered AS (
    SELECT canonical.*
    FROM canonical
    CROSS JOIN bounds
    WHERE range_months IS NULL
      OR canonical.month_start >= (
        bounds.latest_month - ((GREATEST(range_months, 1) - 1) || ' months')::INTERVAL
      )::DATE
  ), summarized AS (
    SELECT
      filtered.vendor_key,
      filtered.month_start,
      SUM(filtered.amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(filtered.amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count,
      MIN(filtered.vendor_value) AS vendor_label
    FROM filtered
    GROUP BY filtered.vendor_key, filtered.month_start
  )
  SELECT
    summarized.vendor_key,
    summarized.vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  ORDER BY summarized.vendor_label, summarized.month_start;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_receipt_vendor_monthly_totals(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_monthly_totals(INTEGER) TO service_role;
