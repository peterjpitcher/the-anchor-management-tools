-- Cross-promotion infrastructure: sms_promo_context table, RPC, and supporting indexes

-- sms_promo_context table
CREATE TABLE sms_promo_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  phone_number TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id),
  template_key TEXT NOT NULL,
  message_id UUID REFERENCES messages(id),
  reply_window_expires_at TIMESTAMPTZ NOT NULL,
  booking_created BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_promo_context_reply_lookup
ON sms_promo_context (phone_number, reply_window_expires_at DESC)
WHERE booking_created = FALSE;

CREATE INDEX idx_sms_promo_context_frequency
ON sms_promo_context (customer_id, created_at DESC);

ALTER TABLE sms_promo_context ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: access is via service-role client only (crons and webhooks).

-- Composite index for audience selection performance
CREATE INDEX idx_ccs_category_last_attended
ON customer_category_stats (category_id, last_attended_date DESC);

-- Audience selection RPC
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
    c.first_name,
    c.last_name,
    c.mobile_e164 AS phone_number,
    ec.name AS last_event_category,
    ccs.times_attended
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
