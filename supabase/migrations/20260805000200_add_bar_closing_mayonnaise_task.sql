-- Add the daily closing mayonnaise task (owner decision 30, 2026-08-05).

WITH closing AS (
  SELECT
    checklist.id,
    COALESCE(bool_or(template.is_active), false) AS templates_are_active
  FROM public.checklists AS checklist
  LEFT JOIN public.checklist_task_templates AS template
    ON template.checklist_id = checklist.id
  WHERE checklist.name = 'Bar Closing'
    AND checklist.department = 'bar'
  GROUP BY checklist.id, checklist.created_at
  ORDER BY checklist.created_at
  LIMIT 1
)
INSERT INTO public.checklist_task_templates
  (checklist_id, title, sort_order, schedule_kind, freq, anchor,
   is_spot_checkable, is_active, version)
SELECT
  closing.id,
  'Put all mayonnaise bottles into the fridge',
  22,
  'calendar',
  'daily',
  'close',
  true,
  closing.templates_are_active,
  1
FROM closing
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_task_templates AS existing
  WHERE existing.checklist_id = closing.id
    AND existing.title = 'Put all mayonnaise bottles into the fridge'
);
