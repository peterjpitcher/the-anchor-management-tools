-- Add weekly pool-table free-play tasks (owner decision 32, 2026-08-05).

UPDATE public.checklists
SET description = 'Bar tasks due every few days, plus weekly pool-table tasks.',
    updated_at = now()
WHERE name = 'Bar Periodic'
  AND department = 'bar';

WITH periodic AS (
  SELECT
    checklist.id,
    COALESCE(bool_or(template.is_active), false) AS templates_are_active
  FROM public.checklists AS checklist
  LEFT JOIN public.checklist_task_templates AS template
    ON template.checklist_id = checklist.id
  WHERE checklist.name = 'Bar Periodic'
    AND checklist.department = 'bar'
  GROUP BY checklist.id, checklist.created_at
  ORDER BY checklist.created_at
  LIMIT 1
), new_tasks(title, sort_order, weekday, anchor_date) AS (
  VALUES
    ('Turn the pool table to free play', 14, 4, DATE '2026-08-06'),
    ('Turn the pool table off free play', 15, 5, DATE '2026-08-07')
)
INSERT INTO public.checklist_task_templates
  (checklist_id, title, sort_order, schedule_kind, freq, by_weekday,
   anchor_date, anchor, is_spot_checkable, is_active, version)
SELECT
  periodic.id,
  new_tasks.title,
  new_tasks.sort_order,
  'calendar',
  'weekly',
  ARRAY[new_tasks.weekday],
  new_tasks.anchor_date,
  'anytime',
  true,
  periodic.templates_are_active,
  1
FROM periodic
CROSS JOIN new_tasks
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_task_templates AS existing
  WHERE existing.checklist_id = periodic.id
    AND existing.title = new_tasks.title
);
