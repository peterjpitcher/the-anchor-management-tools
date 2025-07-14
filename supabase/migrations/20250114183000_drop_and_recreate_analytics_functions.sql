-- Drop and recreate analytics functions to ensure clean state

-- First, drop the functions completely
DROP FUNCTION IF EXISTS get_short_link_analytics(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS get_all_links_analytics(INTEGER);

-- Now recreate get_short_link_analytics without any nested aggregates
CREATE FUNCTION get_short_link_analytics(
  p_short_code VARCHAR,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  click_date DATE,
  total_clicks BIGINT,
  unique_visitors BIGINT,
  mobile_clicks BIGINT,
  desktop_clicks BIGINT,
  tablet_clicks BIGINT,
  top_countries JSONB,
  top_browsers JSONB,
  top_referrers JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  daily_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      COUNT(*)::BIGINT as total_clicks,
      COUNT(DISTINCT slc.ip_address)::BIGINT as unique_visitors,
      COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END)::BIGINT as mobile_clicks,
      COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END)::BIGINT as desktop_clicks,
      COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END)::BIGINT as tablet_clicks
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  )
  SELECT 
    ds.date,
    COALESCE(dst.total_clicks, 0),
    COALESCE(dst.unique_visitors, 0),
    COALESCE(dst.mobile_clicks, 0),
    COALESCE(dst.desktop_clicks, 0),
    COALESCE(dst.tablet_clicks, 0),
    NULL::JSONB,  -- Temporarily return NULL for countries
    NULL::JSONB,  -- Temporarily return NULL for browsers
    NULL::JSONB   -- Temporarily return NULL for referrers
  FROM date_series ds
  LEFT JOIN daily_stats dst ON ds.date = dst.click_date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate get_all_links_analytics with proper types
CREATE FUNCTION get_all_links_analytics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  short_code VARCHAR,
  link_type VARCHAR,
  destination_url TEXT,
  click_dates DATE[],
  click_counts BIGINT[],
  total_clicks BIGINT,
  unique_visitors BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  link_daily_clicks AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      slc.clicked_at::date as click_date,
      COUNT(*)::BIGINT as daily_clicks,
      COUNT(DISTINCT slc.ip_address)::BIGINT as daily_unique
    FROM short_links sl
    LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY sl.short_code, sl.link_type, sl.destination_url, slc.clicked_at::date
  ),
  aggregated AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      array_agg(ds.date ORDER BY ds.date) as dates,
      array_agg(COALESCE(ldc.daily_clicks, 0)::BIGINT ORDER BY ds.date) as clicks,
      COALESCE(SUM(ldc.daily_clicks), 0)::BIGINT as total_click_count,
      COALESCE(SUM(ldc.daily_unique), 0)::BIGINT as unique_visitor_count
    FROM short_links sl
    CROSS JOIN date_series ds
    LEFT JOIN link_daily_clicks ldc ON 
      sl.short_code = ldc.short_code AND 
      ds.date = ldc.click_date
    GROUP BY sl.short_code, sl.link_type, sl.destination_url
  )
  SELECT 
    aggregated.short_code,
    aggregated.link_type,
    aggregated.destination_url,
    aggregated.dates,
    aggregated.clicks,
    aggregated.total_click_count,
    aggregated.unique_visitor_count
  FROM aggregated
  WHERE aggregated.total_click_count > 0
  ORDER BY aggregated.total_click_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;