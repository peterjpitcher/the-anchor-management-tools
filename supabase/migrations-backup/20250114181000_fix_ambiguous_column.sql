-- Fix ambiguous column reference in get_all_links_analytics function

CREATE OR REPLACE FUNCTION get_all_links_analytics(
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
      COUNT(*) as daily_clicks,
      COUNT(DISTINCT slc.ip_address) as daily_unique
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
      array_agg(COALESCE(ldc.daily_clicks, 0) ORDER BY ds.date) as clicks,
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