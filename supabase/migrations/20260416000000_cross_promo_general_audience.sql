-- Extend cross-promo audience RPC with general recent pool
-- Pool 1: category-match (6 months, priority 1)
-- Pool 2: general-recent any event (3 months, priority 2)
-- Dedup via DISTINCT ON (customer_id) with priority ordering

CREATE OR REPLACE FUNCTION get_cross_promo_audience(
  p_event_id UUID,
  p_category_id UUID,
  p_recency_months INT DEFAULT 6,
  p_general_recency_months INT DEFAULT 3,
  p_frequency_cap_days INT DEFAULT 7,
  p_max_recipients INT DEFAULT 200
)
RETURNS TABLE (
  customer_id UUID,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  last_event_category TEXT,
  times_attended BIGINT,
  audience_type TEXT,
  last_event_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH category_pool AS (
    -- Pool 1: same category, 6 months (priority 1)
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      ec.name::TEXT AS last_event_category,
      ccs.times_attended::BIGINT,
      'category_match'::TEXT AS audience_type,
      ec.name::TEXT AS last_event_name,
      1 AS priority,
      ccs.last_attended_date
    FROM customer_category_stats ccs
    JOIN customers c ON c.id = ccs.customer_id
    JOIN event_categories ec ON ec.id = ccs.category_id
    WHERE ccs.category_id = p_category_id
      AND ccs.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.created_at > (NOW() - (p_frequency_cap_days || ' days')::INTERVAL)
      )
  ),
  general_pool AS (
    -- Pool 2: any category, 3 months (priority 2)
    -- Excludes customers already in category_pool
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      NULL::TEXT AS last_event_category,
      NULL::BIGINT AS times_attended,
      'general_recent'::TEXT AS audience_type,
      (
        SELECT e.name
        FROM bookings b2
        JOIN events e ON e.id = b2.event_id
        WHERE b2.customer_id = c.id
          AND b2.is_reminder_only = FALSE
          AND e.date < CURRENT_DATE
          AND e.event_status NOT IN ('cancelled')
        ORDER BY e.date DESC
        LIMIT 1
      )::TEXT AS last_event_name,
      2 AS priority,
      MAX(ccs.last_attended_date) AS last_attended_date
    FROM customer_category_stats ccs
    JOIN customers c ON c.id = ccs.customer_id
    WHERE ccs.last_attended_date >= (CURRENT_DATE - (p_general_recency_months || ' months')::INTERVAL)
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.created_at > (NOW() - (p_frequency_cap_days || ' days')::INTERVAL)
      )
      -- Exclude customers already in category pool
      AND NOT EXISTS (
        SELECT 1 FROM customer_category_stats ccs2
        WHERE ccs2.customer_id = c.id
          AND ccs2.category_id = p_category_id
          AND ccs2.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
      )
    GROUP BY c.id, c.first_name, c.last_name, c.mobile_e164
  ),
  combined AS (
    SELECT * FROM category_pool
    UNION ALL
    SELECT * FROM general_pool
  )
  SELECT DISTINCT ON (combined.customer_id)
    combined.customer_id,
    combined.first_name,
    combined.last_name,
    combined.phone_number,
    combined.last_event_category,
    combined.times_attended,
    combined.audience_type,
    combined.last_event_name
  FROM combined
  ORDER BY combined.customer_id, combined.priority ASC, combined.last_attended_date DESC
  LIMIT p_max_recipients;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Index for general pool cross-category lookup
CREATE INDEX IF NOT EXISTS idx_ccs_last_attended_any
ON customer_category_stats (customer_id, last_attended_date DESC);

-- Harden RPC privileges — service role only
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) TO service_role;
