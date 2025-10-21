-- Monthly insights helpers for receipts dashboard enhancements

CREATE OR REPLACE FUNCTION get_receipt_monthly_category_breakdown(
  limit_months INTEGER DEFAULT 12,
  top_categories INTEGER DEFAULT 6
)
RETURNS TABLE (
  month_start DATE,
  category TEXT,
  total_outgoing NUMERIC(14, 2)
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(expense_category), ''), 'Uncategorised') AS category,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
      AND COALESCE(amount_out, 0) > 0
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT
      category,
      SUM(total_outgoing) AS total_value,
      ROW_NUMBER() OVER (ORDER BY SUM(total_outgoing) DESC) AS rn
    FROM base
    WHERE month_start IN (SELECT month_start FROM month_series)
    GROUP BY category
  ),
  top AS (
    SELECT category
    FROM ranked
    WHERE rn <= GREATEST(top_categories, 1)
  ),
  aggregated AS (
    SELECT
      b.month_start,
      CASE WHEN t.category IS NOT NULL THEN b.category ELSE 'Other' END AS category,
      SUM(b.total_outgoing)::NUMERIC(14, 2) AS total_outgoing
    FROM base b
    LEFT JOIN top t ON t.category = b.category
    WHERE b.month_start IN (SELECT month_start FROM month_series)
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(a.category, 'Other') AS category,
    COALESCE(a.total_outgoing, 0)::NUMERIC(14, 2) AS total_outgoing
  FROM month_series ms
  LEFT JOIN aggregated a ON a.month_start = ms.month_start
  ORDER BY ms.month_start DESC, total_outgoing DESC;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_receipt_monthly_income_breakdown(
  limit_months INTEGER DEFAULT 12,
  top_sources INTEGER DEFAULT 6
)
RETURNS TABLE (
  month_start DATE,
  source TEXT,
  total_income NUMERIC(14, 2)
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS source,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
      AND COALESCE(amount_in, 0) > 0
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT
      source,
      SUM(total_income) AS total_value,
      ROW_NUMBER() OVER (ORDER BY SUM(total_income) DESC) AS rn
    FROM base
    WHERE month_start IN (SELECT month_start FROM month_series)
    GROUP BY source
  ),
  top AS (
    SELECT source
    FROM ranked
    WHERE rn <= GREATEST(top_sources, 1)
  ),
  aggregated AS (
    SELECT
      b.month_start,
      CASE WHEN t.source IS NOT NULL THEN b.source ELSE 'Other' END AS source,
      SUM(b.total_income)::NUMERIC(14, 2) AS total_income
    FROM base b
    LEFT JOIN top t ON t.source = b.source
    WHERE b.month_start IN (SELECT month_start FROM month_series)
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(a.source, 'Other') AS source,
    COALESCE(a.total_income, 0)::NUMERIC(14, 2) AS total_income
  FROM month_series ms
  LEFT JOIN aggregated a ON a.month_start = ms.month_start
  ORDER BY ms.month_start DESC, total_income DESC;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_receipt_monthly_status_counts(limit_months INTEGER DEFAULT 12)
RETURNS TABLE (
  month_start DATE,
  status receipt_transaction_status,
  total BIGINT
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      status,
      COUNT(*) AS total
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(b.status, 'pending') AS status,
    COALESCE(b.total, 0)::BIGINT AS total
  FROM month_series ms
  LEFT JOIN base b ON b.month_start = ms.month_start
  ORDER BY ms.month_start DESC, status;
$$ LANGUAGE SQL STABLE;
