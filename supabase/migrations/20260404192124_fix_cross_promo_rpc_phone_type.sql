-- Fix type mismatches: varchar(20)->TEXT for phone, integer->BIGINT for times_attended
CREATE OR REPLACE FUNCTION get_cross_promo_audience(
  p_event_id UUID,
  p_category_id UUID,
  p_recency_months INT DEFAULT 6,
  p_frequency_cap_days INT DEFAULT 7,
  p_max_recipients INT DEFAULT 100
)
RETURNS TABLE (
  customer_id UUID,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  last_event_category TEXT,
  times_attended BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS customer_id,
    c.first_name::TEXT,
    c.last_name::TEXT,
    c.mobile_e164::TEXT AS phone_number,
    ec.name::TEXT AS last_event_category,
    ccs.times_attended::BIGINT
  FROM customer_category_stats ccs
  JOIN customers c ON c.id = ccs.customer_id
  JOIN event_categories ec ON ec.id = ccs.category_id
  WHERE ccs.category_id = p_category_id
    AND ccs.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
    AND c.marketing_sms_opt_in = TRUE
    AND c.sms_opt_in = TRUE
    AND (c.sms_status IS NULL OR c.sms_status = 'active')
    AND c.mobile_e164 IS NOT NULL
    -- Exclude customers already booked for this event
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.customer_id = c.id
        AND b.event_id = p_event_id
        AND b.status IN ('pending_payment', 'confirmed')
        AND b.is_reminder_only = FALSE
    )
    -- Exclude customers who received a promo in the last N days
    AND NOT EXISTS (
      SELECT 1 FROM sms_promo_context spc
      WHERE spc.customer_id = c.id
        AND spc.created_at > (NOW() - (p_frequency_cap_days || ' days')::INTERVAL)
    )
  ORDER BY ccs.last_attended_date DESC
  LIMIT p_max_recipients;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
