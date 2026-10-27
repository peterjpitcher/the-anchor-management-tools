-- Rollback for supabase/migrations/20261026224114_promo_audience_consent_basis.sql.
-- Restores production's definition exactly (md5(prosrc) 2e7eb2740facd6397bea90194ae0c661) and its
-- grants: service_role only.

CREATE OR REPLACE FUNCTION public.get_cross_promo_audience(
  p_event_id uuid,
  p_category_id uuid,
  p_recency_days integer DEFAULT 180,
  p_general_recency_days integer DEFAULT 180,
  p_frequency_window_days integer DEFAULT 14,
  p_max_events_per_window integer DEFAULT 2,
  p_max_recipients integer DEFAULT 30
)
RETURNS TABLE(
  customer_id uuid,
  first_name text,
  last_name text,
  phone_number text,
  last_event_category text,
  times_attended bigint,
  audience_type text,
  last_event_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      AND b.status IN ('confirmed', 'completed', 'visited_waiting_for_review', 'review_clicked')
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
  frequency_blocked AS (
    SELECT spc.customer_id
    FROM sms_promo_context spc
    WHERE spc.created_at > (NOW() - (p_frequency_window_days * INTERVAL '1 day'))
      AND spc.event_id IS DISTINCT FROM p_event_id
    GROUP BY spc.customer_id
    HAVING COUNT(DISTINCT spc.event_id) >= p_max_events_per_window
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
      -- Soft opt-in: the SMS channel is live and they have never opted out of
      -- marketing. Replaces the previous c.marketing_sms_opt_in = TRUE.
      AND c.sms_opt_in = TRUE
      AND c.marketing_sms_opted_out_at IS NULL
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
        SELECT 1 FROM frequency_blocked fb WHERE fb.customer_id = c.id
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
      -- Soft opt-in: see the note in category_pool above.
      AND c.sms_opt_in = TRUE
      AND c.marketing_sms_opted_out_at IS NULL
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
        SELECT 1 FROM frequency_blocked fb WHERE fb.customer_id = c.id
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
  ),
  deduped AS (
    SELECT DISTINCT ON (combined.customer_id)
      combined.customer_id,
      combined.first_name,
      combined.last_name,
      combined.phone_number,
      combined.last_event_category,
      combined.times_attended,
      combined.audience_type,
      combined.last_event_name,
      combined.priority,
      combined.last_attended_date
    FROM combined
    ORDER BY combined.customer_id, combined.priority ASC, combined.last_attended_date DESC
  )
  SELECT
    d.customer_id,
    d.first_name,
    d.last_name,
    d.phone_number,
    d.last_event_category,
    d.times_attended,
    d.audience_type,
    d.last_event_name
  FROM deduped d
  ORDER BY d.priority ASC, d.last_attended_date DESC, d.customer_id ASC
  LIMIT p_max_recipients;
END;
$function$;

-- Grants restated exactly as production holds them: service_role only (checked 26 October 2026,
-- has_function_privilege). CREATE OR REPLACE keeps them, but a migration says what it expects.
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) TO service_role;
