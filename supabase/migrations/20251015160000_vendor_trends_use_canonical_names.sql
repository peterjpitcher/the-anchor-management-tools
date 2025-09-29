BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_vendor_trends(month_window INTEGER DEFAULT 12)
RETURNS TABLE (
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH source AS (
    SELECT
      rt.transaction_date,
      COALESCE(NULLIF(TRIM(rr.set_vendor_name), ''), NULLIF(TRIM(rt.vendor_name), '')) AS vendor_value,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM receipt_transactions rt
    LEFT JOIN receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  ), canonical AS (
    SELECT
      LOWER(REGEXP_REPLACE(vendor_value, '\\s+', ' ', 'g')) AS vendor_key,
      vendor_value,
      date_trunc('month', transaction_date)::DATE AS month_start,
      amount_out,
      amount_in
    FROM source
    WHERE vendor_value IS NOT NULL
  ), filtered AS (
    SELECT *
    FROM canonical
    WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ), summarized AS (
    SELECT
      vendor_key,
      month_start,
      SUM(amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count,
      MIN(vendor_value) AS vendor_label
    FROM filtered
    GROUP BY vendor_key, month_start
  )
  SELECT
    summarized.vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  ORDER BY summarized.vendor_label, summarized.month_start;
$$ LANGUAGE SQL STABLE;

COMMIT;
