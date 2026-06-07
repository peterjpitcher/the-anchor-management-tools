-- Rework event promotional SMS policy:
-- - 7-day intro + 24-hour follow-up
-- - same-category attendees from 90 days
-- - general event attendees from 42 days
-- - one intro per customer per event
-- - no active reply windows for disabled/draft/cancelled/closed events

ALTER TABLE promo_sequence
  ADD COLUMN IF NOT EXISTS touch_24h_sent_at TIMESTAMPTZ;

UPDATE promo_sequence
SET touch_24h_sent_at = touch_3d_sent_at
WHERE touch_24h_sent_at IS NULL
  AND touch_3d_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promo_sequence_24h_pending
  ON promo_sequence (event_id)
  WHERE touch_24h_sent_at IS NULL;

UPDATE sms_promo_context spc
SET reply_window_expires_at = NOW()
FROM events e
WHERE e.id = spc.event_id
  AND spc.booking_created = FALSE
  AND spc.reply_window_expires_at > NOW()
  AND (
    e.promo_sms_enabled = FALSE
    OR COALESCE(e.booking_open, TRUE) = FALSE
    OR COALESCE(e.event_status, 'scheduled') IN ('cancelled', 'draft')
  );

DELETE FROM promo_sequence ps
USING events e
WHERE e.id = ps.event_id
  AND (
    e.promo_sms_enabled = FALSE
    OR COALESCE(e.booking_open, TRUE) = FALSE
    OR COALESCE(e.event_status, 'scheduled') IN ('cancelled', 'draft')
  );

DROP FUNCTION IF EXISTS public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT);

CREATE FUNCTION get_cross_promo_audience(
  p_event_id UUID,
  p_category_id UUID,
  p_recency_days INT DEFAULT 90,
  p_general_recency_days INT DEFAULT 42,
  p_frequency_cap_days INT DEFAULT 7,
  p_max_recipients INT DEFAULT 30
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
      AND ca.last_attended_date >= (CURRENT_DATE - (p_recency_days * INTERVAL '1 day'))
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
          AND spc.event_id = p_event_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.created_at > (NOW() - (p_frequency_cap_days * INTERVAL '1 day'))
      )
  ),
  general_pool AS (
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
    WHERE ra.last_attended_date >= (CURRENT_DATE - (p_general_recency_days * INTERVAL '1 day'))
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
          AND spc.event_id = p_event_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.created_at > (NOW() - (p_frequency_cap_days * INTERVAL '1 day'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM category_attendance ca2
        WHERE ca2.customer_id = c.id
          AND ca2.category_id = p_category_id
          AND ca2.last_attended_date >= (CURRENT_DATE - (p_recency_days * INTERVAL '1 day'))
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

CREATE OR REPLACE FUNCTION get_follow_up_recipients(
  p_event_id UUID,
  p_touch_type TEXT,
  p_min_gap_iso TIMESTAMPTZ
)
RETURNS TABLE (
  customer_id UUID,
  first_name TEXT,
  phone_number TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS customer_id,
    c.first_name::TEXT,
    c.mobile_e164::TEXT AS phone_number
  FROM promo_sequence ps
  JOIN customers c ON c.id = ps.customer_id
  WHERE ps.event_id = p_event_id
    AND ps.touch_14d_sent_at IS NOT NULL
    AND ps.touch_14d_sent_at <= p_min_gap_iso
    AND (
      (p_touch_type = '24h' AND ps.touch_24h_sent_at IS NULL) OR
      (p_touch_type = '3d' AND ps.touch_3d_sent_at IS NULL)
    )
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
  ORDER BY ps.touch_14d_sent_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.get_follow_up_recipients(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_up_recipients(UUID, TEXT, TIMESTAMPTZ) TO service_role;
