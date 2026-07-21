-- Capture the 2026-07-20 production data change: "Spray pool table" runs on
-- Sundays, not Mondays. The seed (20260731000100_seed_bar_checklist.sql:156)
-- created it with by_weekday = ARRAY[1] (Monday; getUTCDay convention,
-- Sun=0..Sat=6) and anchor_date 2026-08-03. Production was updated in place,
-- so this migration brings source in line and stops a rebuild silently
-- reverting the schedule. Idempotent: prod already holds these values.
UPDATE public.checklist_task_templates
SET by_weekday = ARRAY[0],
    anchor_date = DATE '2026-08-02'
WHERE title = 'Spray pool table'
  AND schedule_kind = 'calendar'
  AND freq = 'weekly';
