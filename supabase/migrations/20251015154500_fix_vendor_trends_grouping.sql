BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_vendor_trends(month_window INTEGER DEFAULT 12)
RETURNS TABLE (
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH classified AS (
    SELECT
      CASE
        WHEN transaction_date IS NULL THEN NULL
        WHEN vendor_name IS NULL OR TRIM(vendor_name) = '' THEN NULL
        ELSE LOWER(REGEXP_REPLACE(TRIM(vendor_name), '\\s+', ' ', 'g'))
      END AS vendor_key,
      CASE
        WHEN vendor_name IS NULL OR TRIM(vendor_name) = '' THEN NULL
        ELSE REGEXP_REPLACE(TRIM(vendor_name), '\\s+', ' ', 'g')
      END AS vendor_label,
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
  ), filtered AS (
    SELECT *
    FROM classified
    WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ), summarized AS (
    SELECT
      COALESCE(vendor_key, '__uncategorised__') AS vendor_key,
      month_start,
      SUM(amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count
    FROM filtered
    GROUP BY COALESCE(vendor_key, '__uncategorised__'), month_start
  ), labels AS (
    SELECT
      COALESCE(vendor_key, '__uncategorised__') AS vendor_key,
      MIN(vendor_label) FILTER (WHERE vendor_label IS NOT NULL) AS vendor_label
    FROM classified
    GROUP BY COALESCE(vendor_key, '__uncategorised__')
  )
  SELECT
    CASE
      WHEN summarized.vendor_key = '__uncategorised__' THEN 'Uncategorised'
      ELSE COALESCE(labels.vendor_label, INITCAP(REGEXP_REPLACE(summarized.vendor_key, '_', ' ', 'g')))
    END AS vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  LEFT JOIN labels ON labels.vendor_key = summarized.vendor_key
  ORDER BY vendor_label, month_start;
$$ LANGUAGE SQL STABLE;

COMMIT;
