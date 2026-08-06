-- Add daily opening garden tasks (owner decision 31, 2026-08-05).

UPDATE public.checklist_task_templates AS template
SET sort_order = 22,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title = 'Load candles into holders and light at open'
  AND template.sort_order = 19;

WITH opening AS (
  SELECT
    checklist.id,
    COALESCE(bool_or(template.is_active), false) AS templates_are_active
  FROM public.checklists AS checklist
  LEFT JOIN public.checklist_task_templates AS template
    ON template.checklist_id = checklist.id
  WHERE checklist.name = 'Bar Opening'
    AND checklist.department = 'bar'
  GROUP BY checklist.id, checklist.created_at
  ORDER BY checklist.created_at
  LIMIT 1
), new_tasks(title, sort_order) AS (
  VALUES
    ('Water outside plants in the back garden (one watering can per pot)', 19),
    ('Sweep the stones', 20)
)
INSERT INTO public.checklist_task_templates
  (checklist_id, title, sort_order, schedule_kind, freq, anchor,
   is_spot_checkable, is_active, version)
SELECT
  opening.id,
  new_tasks.title,
  new_tasks.sort_order,
  'calendar',
  'daily',
  'open',
  true,
  opening.templates_are_active,
  1
FROM opening
CROSS JOIN new_tasks
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_task_templates AS existing
  WHERE existing.checklist_id = opening.id
    AND existing.title = new_tasks.title
);
