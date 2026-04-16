-- RPC to load follow-up recipients with consent re-check, booking exclusion, and event validation
CREATE OR REPLACE FUNCTION get_follow_up_recipients(
  p_event_id UUID,
  p_touch_type TEXT,  -- '7d' or '3d'
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
    -- Touch not yet sent
    AND (
      (p_touch_type = '7d' AND ps.touch_7d_sent_at IS NULL) OR
      (p_touch_type = '3d' AND ps.touch_3d_sent_at IS NULL)
    )
    -- Re-check marketing consent
    AND c.marketing_sms_opt_in = TRUE
    AND c.sms_opt_in = TRUE
    AND (c.sms_status IS NULL OR c.sms_status = 'active')
    AND c.mobile_e164 IS NOT NULL
    -- Exclude customers already booked
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

-- Privilege hardening
REVOKE ALL ON FUNCTION public.get_follow_up_recipients(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_up_recipients(UUID, TEXT, TIMESTAMPTZ) TO service_role;
