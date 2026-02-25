-- ============================================================
-- 1. Normalize receipt details — strips trailing reference codes
-- ============================================================
CREATE OR REPLACE FUNCTION normalize_receipt_details(p_details TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result TEXT;
BEGIN
  IF p_details IS NULL THEN
    RETURN NULL;
  END IF;

  v_result := p_details;

  -- Strip trailing alphanumeric reference codes like *AB12CD or /REF123
  v_result := regexp_replace(v_result, '[*/][A-Z0-9]{4,10}\s*$', '', 'i');

  -- Strip trailing 6+ digit numbers (transaction refs)
  v_result := regexp_replace(v_result, '\s+\d{6,}\s*$', '');

  RETURN TRIM(v_result);
END;
$$;

-- ============================================================
-- 2. Replace get_receipt_detail_groups with fuzzy-grouping version
-- ============================================================
CREATE OR REPLACE FUNCTION get_receipt_detail_groups(
  limit_groups INTEGER DEFAULT 10,
  include_statuses TEXT[] DEFAULT ARRAY['pending'],
  only_unclassified BOOLEAN DEFAULT TRUE,
  use_fuzzy_grouping BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  details TEXT,
  transaction_ids TEXT[],
  transaction_count BIGINT,
  needs_vendor_count BIGINT,
  needs_expense_count BIGINT,
  total_in NUMERIC,
  total_out NUMERIC,
  first_date DATE,
  last_date DATE,
  dominant_vendor TEXT,
  dominant_expense TEXT,
  sample_transaction JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      CASE WHEN use_fuzzy_grouping
        THEN normalize_receipt_details(rt.details)
        ELSE rt.details
      END AS group_key,
      rt.id,
      rt.details,
      rt.transaction_date,
      rt.amount_in,
      rt.amount_out,
      rt.vendor_name,
      rt.vendor_source,
      rt.expense_category,
      rt.expense_category_source,
      rt.transaction_type
    FROM receipt_transactions rt
    WHERE rt.status = ANY(include_statuses)
      AND (
        NOT only_unclassified
        OR rt.vendor_name IS NULL
        OR rt.expense_category IS NULL
      )
  ),
  aggregated AS (
    SELECT
      g.group_key AS grp_details,
      ARRAY_AGG(g.id::TEXT ORDER BY g.transaction_date DESC) AS grp_ids,
      COUNT(*)::BIGINT AS grp_count,
      COUNT(*) FILTER (WHERE g.vendor_name IS NULL)::BIGINT AS grp_needs_vendor,
      COUNT(*) FILTER (WHERE g.expense_category IS NULL AND g.amount_out > 0)::BIGINT AS grp_needs_expense,
      SUM(COALESCE(g.amount_in, 0)) AS grp_total_in,
      SUM(COALESCE(g.amount_out, 0)) AS grp_total_out,
      MIN(g.transaction_date) AS grp_first_date,
      MAX(g.transaction_date) AS grp_last_date,
      -- Dominant vendor: most common non-null vendor
      (
        SELECT g2.vendor_name
        FROM grouped g2
        WHERE g2.group_key = g.group_key AND g2.vendor_name IS NOT NULL
        GROUP BY g2.vendor_name
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS grp_dominant_vendor,
      -- Dominant expense: most common non-null expense
      (
        SELECT g2.expense_category
        FROM grouped g2
        WHERE g2.group_key = g.group_key AND g2.expense_category IS NOT NULL
        GROUP BY g2.expense_category
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS grp_dominant_expense,
      -- Sample: one representative transaction
      (
        SELECT jsonb_build_object(
          'id', g2.id,
          'transaction_date', g2.transaction_date,
          'transaction_type', g2.transaction_type,
          'amount_in', g2.amount_in,
          'amount_out', g2.amount_out,
          'vendor_name', g2.vendor_name,
          'vendor_source', g2.vendor_source,
          'expense_category', g2.expense_category,
          'expense_category_source', g2.expense_category_source
        )
        FROM grouped g2
        WHERE g2.group_key = g.group_key
        ORDER BY g2.transaction_date DESC
        LIMIT 1
      ) AS grp_sample
    FROM grouped g
    WHERE g.group_key IS NOT NULL AND g.group_key <> ''
    GROUP BY g.group_key
  )
  SELECT
    a.grp_details,
    a.grp_ids,
    a.grp_count,
    a.grp_needs_vendor,
    a.grp_needs_expense,
    a.grp_total_in,
    a.grp_total_out,
    a.grp_first_date,
    a.grp_last_date,
    a.grp_dominant_vendor,
    a.grp_dominant_expense,
    a.grp_sample
  FROM aggregated a
  ORDER BY a.grp_count DESC
  LIMIT limit_groups;
END;
$$;

-- ============================================================
-- 3. AI usage breakdown RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_ai_usage_breakdown()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_cost', COALESCE(SUM(cost), 0),
    'this_month_cost', COALESCE(SUM(CASE WHEN occurred_at >= date_trunc('month', NOW()) THEN cost ELSE 0 END), 0),
    'total_classifications', COUNT(*),
    'this_month_classifications', COUNT(*) FILTER (WHERE occurred_at >= date_trunc('month', NOW())),
    'model_breakdown', (
      SELECT jsonb_agg(mb ORDER BY mb->>'model')
      FROM (
        SELECT jsonb_build_object(
          'model', model,
          'total_cost', SUM(cost),
          'total_tokens', SUM(total_tokens),
          'call_count', COUNT(*)
        ) AS mb
        FROM ai_usage_events
        GROUP BY model
      ) sub
    )
  )
  INTO v_result
  FROM ai_usage_events;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;
