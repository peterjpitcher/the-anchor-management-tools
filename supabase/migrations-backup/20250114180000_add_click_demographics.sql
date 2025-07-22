-- Add demographic data fields to short_link_clicks for better analytics
-- This allows us to capture and analyze visitor demographics

-- Add new columns for demographic data
ALTER TABLE short_link_clicks
ADD COLUMN IF NOT EXISTS country VARCHAR(2),
ADD COLUMN IF NOT EXISTS city VARCHAR(100),
ADD COLUMN IF NOT EXISTS region VARCHAR(100),
ADD COLUMN IF NOT EXISTS device_type VARCHAR(20) CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
ADD COLUMN IF NOT EXISTS browser VARCHAR(50),
ADD COLUMN IF NOT EXISTS os VARCHAR(50),
ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100),
ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100),
ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100);

-- Create indexes for demographic queries
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_country ON short_link_clicks(country);
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_device_type ON short_link_clicks(device_type);
-- Index on the timestamp column directly (the date casting will use this index)
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_clicked_at ON short_link_clicks(clicked_at);

-- Create a view for daily click aggregations (simplified without nested aggregations)
CREATE OR REPLACE VIEW short_link_daily_stats AS
SELECT 
  sl.id as short_link_id,
  sl.short_code,
  sl.link_type,
  slc.clicked_at::date as click_date,
  COUNT(*) as total_clicks,
  COUNT(DISTINCT slc.ip_address) as unique_visitors,
  COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END) as mobile_clicks,
  COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END) as desktop_clicks,
  COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END) as tablet_clicks
FROM short_links sl
LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
WHERE slc.clicked_at IS NOT NULL
GROUP BY sl.id, sl.short_code, sl.link_type, slc.clicked_at::date;

-- Grant permissions on the view
GRANT SELECT ON short_link_daily_stats TO authenticated;

-- Create a function to get analytics for a specific link with date range (simplified)
CREATE OR REPLACE FUNCTION get_short_link_analytics(
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
      COUNT(*) as total_clicks,
      COUNT(DISTINCT slc.ip_address) as unique_visitors,
      COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END) as mobile_clicks,
      COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END) as desktop_clicks,
      COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END) as tablet_clicks
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  ),
  country_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.country, 'Unknown'), count(*)) as countries
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
      AND slc.country IS NOT NULL
    GROUP BY slc.clicked_at::date
  ),
  browser_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.browser, 'Unknown'), count(*)) as browsers
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
      AND slc.browser IS NOT NULL
    GROUP BY slc.clicked_at::date
  ),
  referrer_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.referrer, 'Direct'), count(*)) as referrers
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
    cs.countries,
    bs.browsers,
    rs.referrers
  FROM date_series ds
  LEFT JOIN daily_stats dst ON ds.date = dst.click_date
  LEFT JOIN country_stats cs ON ds.date = cs.click_date
  LEFT JOIN browser_stats bs ON ds.date = bs.click_date
  LEFT JOIN referrer_stats rs ON ds.date = rs.click_date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to get aggregated analytics for all links
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
    GROUP BY sl.short_code, sl.link_type, sl.destination_url, DATE(slc.clicked_at)
  ),
  aggregated AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      array_agg(ds.date ORDER BY ds.date) as dates,
      array_agg(COALESCE(ldc.daily_clicks, 0) ORDER BY ds.date) as clicks,
      COALESCE(SUM(ldc.daily_clicks), 0) as total_clicks,
      COALESCE(SUM(ldc.daily_unique), 0) as unique_visitors
    FROM short_links sl
    CROSS JOIN date_series ds
    LEFT JOIN link_daily_clicks ldc ON 
      sl.short_code = ldc.short_code AND 
      ds.date = ldc.click_date
    GROUP BY sl.short_code, sl.link_type, sl.destination_url
  )
  SELECT * FROM aggregated
  WHERE total_clicks > 0
  ORDER BY total_clicks DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;