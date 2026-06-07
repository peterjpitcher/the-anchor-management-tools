-- Harden cross-promo audience selection.
-- Promotional "past attendee" audiences must be based on confirmed past
-- attendance, not future bookings that have only just been created.

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
  WITH valid_attendance AS (
    SELECT
      b.customer_id,
      e.category_id,
      e.name::TEXT AS event_name,
      e.date
    FROM bookings b
    JOIN events e ON e.id = b.event_id
    WHERE e.category_id IS NOT NULL
      AND b.seats > 0
      AND b.status = 'confirmed'
      AND (b.is_reminder_only IS NULL OR b.is_reminder_only = FALSE)
      AND e.date < CURRENT_DATE
      AND (e.event_status IS NULL OR e.event_status NOT IN ('cancelled', 'draft'))
  ),
  category_attendance AS (
    SELECT
      va.customer_id,
      va.category_id,
      COUNT(*)::BIGINT AS times_attended,
      MAX(va.date) AS last_attended_date
    FROM valid_attendance va
    GROUP BY va.customer_id, va.category_id
  ),
  recent_attendance AS (
    SELECT
      ca.customer_id,
      MAX(ca.last_attended_date) AS last_attended_date
    FROM category_attendance ca
    GROUP BY ca.customer_id
  ),
  last_attended_event AS (
    SELECT DISTINCT ON (va.customer_id)
      va.customer_id,
      va.event_name AS last_event_name
    FROM valid_attendance va
    ORDER BY va.customer_id, va.date DESC, va.event_name ASC
  ),
  category_pool AS (
    -- Pool 1: same category, recent confirmed past attendance.
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      ec.name::TEXT AS last_event_category,
      ca.times_attended,
      'category_match'::TEXT AS audience_type,
      ec.name::TEXT AS last_event_name,
      1 AS priority,
      ca.last_attended_date
    FROM category_attendance ca
    JOIN customers c ON c.id = ca.customer_id
    JOIN event_categories ec ON ec.id = ca.category_id
    WHERE ca.category_id = p_category_id
      AND ca.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
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
    -- Pool 2: any recent confirmed past attendance.
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      NULL::TEXT AS last_event_category,
      NULL::BIGINT AS times_attended,
      'general_recent'::TEXT AS audience_type,
      lae.last_event_name,
      2 AS priority,
      ra.last_attended_date
    FROM recent_attendance ra
    JOIN customers c ON c.id = ra.customer_id
    LEFT JOIN last_attended_event lae ON lae.customer_id = c.id
    WHERE ra.last_attended_date >= (CURRENT_DATE - (p_general_recency_months || ' months')::INTERVAL)
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
      -- Exclude customers already in category pool.
      AND NOT EXISTS (
        SELECT 1 FROM category_attendance ca2
        WHERE ca2.customer_id = c.id
          AND ca2.category_id = p_category_id
          AND ca2.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
      )
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

REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) TO service_role;
