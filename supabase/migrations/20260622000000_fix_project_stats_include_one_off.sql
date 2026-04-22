-- Fix: include one_off entries in project budget spend calculation
-- The original view (20260121130000) only handled 'time' and 'mileage' entry types.
-- When one_off charges were added (20260226120000), this view was not updated,
-- causing one-off charges to be excluded from project budget tracking.

CREATE OR REPLACE VIEW public.oj_project_stats AS
SELECT
  project_id,
  -- Sum duration_minutes_rounded -> hours (only time entries have hours)
  COALESCE(SUM(duration_minutes_rounded) / 60.0, 0) as total_hours_used,

  -- Sum spend across all entry types
  COALESCE(
    SUM(
      CASE
        WHEN entry_type = 'time' THEN
          (duration_minutes_rounded / 60.0) * COALESCE(hourly_rate_ex_vat_snapshot, 0)
        WHEN entry_type = 'mileage' THEN
          miles * COALESCE(mileage_rate_snapshot, 0)
        WHEN entry_type = 'one_off' THEN
          COALESCE(amount_ex_vat_snapshot, 0)
        ELSE 0
      END
    ),
    0
  ) as total_spend_ex_vat

FROM public.oj_entries
GROUP BY project_id;
