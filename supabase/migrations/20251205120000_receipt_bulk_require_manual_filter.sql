-- Tune receipt bulk grouping to focus on fully unclassified rows
BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_detail_groups(
  limit_groups INTEGER DEFAULT 100,
  include_statuses TEXT[] DEFAULT ARRAY['pending','auto_completed','completed','no_receipt_required','cant_find'],
  only_unclassified BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  details TEXT,
  transaction_ids UUID[],
  transaction_count BIGINT,
  needs_vendor_count BIGINT,
  needs_expense_count BIGINT,
  total_in NUMERIC(14, 2),
  total_out NUMERIC(14, 2),
  first_date DATE,
  last_date DATE,
  dominant_vendor TEXT,
  dominant_expense TEXT,
  sample_transaction JSONB
) AS $$
  WITH filtered AS (
    SELECT *
    FROM receipt_transactions
    WHERE details IS NOT NULL
      AND details <> ''
      AND (include_statuses IS NULL OR status::text = ANY(include_statuses))
      AND (
        NOT only_unclassified
        OR (
          (vendor_name IS NULL OR btrim(vendor_name) = '')
          AND expense_category IS NULL
        )
      )
  ), grouped AS (
    SELECT
      details,
      ARRAY_AGG(id ORDER BY transaction_date DESC) AS transaction_ids,
      COUNT(*) AS transaction_count,
      COUNT(*) FILTER (WHERE vendor_name IS NULL OR btrim(vendor_name) = '') AS needs_vendor_count,
      COUNT(*) FILTER (WHERE expense_category IS NULL) AS needs_expense_count,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_in,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_out,
      MIN(transaction_date)::DATE AS first_date,
      MAX(transaction_date)::DATE AS last_date,
      MODE() WITHIN GROUP (ORDER BY vendor_name) FILTER (WHERE vendor_name IS NOT NULL AND btrim(vendor_name) <> '') AS dominant_vendor,
      MODE() WITHIN GROUP (ORDER BY expense_category) FILTER (WHERE expense_category IS NOT NULL) AS dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', t.id,
          'transaction_date', t.transaction_date,
          'transaction_type', t.transaction_type,
          'amount_in', t.amount_in,
          'amount_out', t.amount_out,
          'vendor_name', t.vendor_name,
          'vendor_source', t.vendor_source,
          'expense_category', t.expense_category,
          'expense_category_source', t.expense_category_source
        )
        FROM filtered t
        WHERE t.details = rt.details
        ORDER BY
          CASE
            WHEN (t.vendor_name IS NULL OR btrim(t.vendor_name) = '') AND t.expense_category IS NULL THEN 0
            WHEN (t.vendor_name IS NULL OR btrim(t.vendor_name) = '') OR t.expense_category IS NULL THEN 1
            ELSE 2
          END,
          t.transaction_date DESC
        LIMIT 1
      ) AS sample_transaction
    FROM filtered rt
    GROUP BY details
    ORDER BY transaction_count DESC, details ASC
    LIMIT GREATEST(limit_groups, 1)
  )
  SELECT * FROM grouped;
$$ LANGUAGE SQL STABLE;

COMMIT;
