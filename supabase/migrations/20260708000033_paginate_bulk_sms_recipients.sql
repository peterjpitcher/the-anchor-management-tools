-- A-086: paginate bulk SMS recipients and return a total count.

CREATE OR REPLACE FUNCTION public.get_bulk_sms_recipients(
  p_event_id UUID DEFAULT NULL,
  p_booking_status TEXT DEFAULT NULL,
  p_sms_opt_in_only BOOLEAN DEFAULT TRUE,
  p_category_id UUID DEFAULT NULL,
  p_created_after DATE DEFAULT NULL,
  p_created_before DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  mobile_number TEXT,
  last_booking_date DATE,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page INTEGER := greatest(coalesce(p_page, 1), 1);
  v_page_size INTEGER := least(greatest(coalesce(p_page_size, 50), 1), 100);
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT
      c.id,
      CASE
        WHEN lower(btrim(coalesce(c.first_name, ''))) = 'null' THEN ''
        ELSE coalesce(c.first_name, '')
      END::TEXT AS first_name,
      CASE
        WHEN lower(btrim(coalesce(c.last_name, ''))) = 'null' THEN ''
        ELSE coalesce(c.last_name, '')
      END::TEXT AS last_name,
      c.mobile_e164::TEXT AS mobile_number,
      (
        SELECT MAX(e.date)
        FROM public.bookings b
        JOIN public.events e ON e.id = b.event_id
        WHERE b.customer_id = c.id
          AND b.status IN ('pending_payment', 'confirmed')
          AND COALESCE(b.is_reminder_only, false) = false
      )::DATE AS last_booking_date
    FROM public.customers c
    WHERE
      c.mobile_e164 IS NOT NULL
      AND c.sms_opt_in = TRUE
      AND c.marketing_sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND (
        p_event_id IS NULL
        OR p_booking_status IS NULL
        OR (
          p_booking_status = 'with_bookings'
          AND EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.customer_id = c.id
              AND b.event_id = p_event_id
              AND b.status IN ('pending_payment', 'confirmed')
              AND COALESCE(b.is_reminder_only, false) = false
          )
        )
        OR (
          p_booking_status = 'without_bookings'
          AND NOT EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.customer_id = c.id
              AND b.event_id = p_event_id
              AND b.status IN ('pending_payment', 'confirmed')
              AND COALESCE(b.is_reminder_only, false) = false
          )
        )
      )
      AND (
        p_category_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.bookings b
          JOIN public.events e ON e.id = b.event_id
          WHERE b.customer_id = c.id
            AND e.category_id = p_category_id
            AND b.status IN ('pending_payment', 'confirmed')
            AND COALESCE(b.is_reminder_only, false) = false
        )
      )
      AND (p_created_after IS NULL OR c.created_at >= p_created_after)
      AND (p_created_before IS NULL OR c.created_at <= (p_created_before + INTERVAL '1 day'))
      AND (
        p_search IS NULL
        OR c.first_name ILIKE '%' || p_search || '%'
        OR c.last_name ILIKE '%' || p_search || '%'
        OR c.mobile_e164 ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    filtered.id,
    filtered.first_name,
    filtered.last_name,
    filtered.mobile_number,
    filtered.last_booking_date,
    count(*) OVER() AS total_count
  FROM filtered
  ORDER BY filtered.last_name, filtered.first_name
  LIMIT v_page_size
  OFFSET (v_page - 1) * v_page_size;
END;
$$;
