-- Create a view to aggregate project usage stats
CREATE OR REPLACE VIEW public.oj_project_stats AS
SELECT
  project_id,
  -- Sum duration_minutes_rounded -> hours
  COALESCE(SUM(duration_minutes_rounded) / 60.0, 0) as total_hours_used,
  
  -- Sum spend:
  -- For time: duration * hourly_rate (from snapshot or setting)
  -- For mileage: miles * mileage_rate (from snapshot)
  COALESCE(
    SUM(
      CASE 
        WHEN entry_type = 'time' THEN 
          (duration_minutes_rounded / 60.0) * COALESCE(hourly_rate_ex_vat_snapshot, 0)
        WHEN entry_type = 'mileage' THEN
          miles * COALESCE(mileage_rate_snapshot, 0)
        ELSE 0
      END
    ), 
    0
  ) as total_spend_ex_vat

FROM public.oj_entries
GROUP BY project_id;

-- Grant access
GRANT SELECT ON public.oj_project_stats TO authenticated;
