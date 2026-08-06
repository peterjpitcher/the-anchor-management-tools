-- Opening only requires the machines to be switched on. Cleaning is a separate
-- every-other-day task (owner decision 28, 2026-08-05).

UPDATE public.checklist_task_templates AS template
SET title = 'Switch on TVs, fruit machine and jukebox',
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title = 'All machines switched on and cleaned (all TVs, fruit machine, and jukebox)';

UPDATE public.checklists
SET description = 'Bar tasks due every few days, plus weekly pool-table tasks.',
    updated_at = now()
WHERE name = 'Bar Periodic'
  AND department = 'bar';

UPDATE public.checklist_task_templates AS template
SET title = 'Whatsapp Pete if you need more menus (main, Sunday, Kids, etc).',
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title = 'Menus ready (WhatsApp Pete if you need more)';

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
)
INSERT INTO public.checklist_task_templates
  (checklist_id, title, sort_order, schedule_kind, freq, freq_interval,
   anchor_date, anchor, is_spot_checkable, is_active, version)
SELECT
  periodic.id,
  'Clean TVs, fruit machine and jukebox',
  13,
  'calendar',
  'daily',
  2,
  DATE '2026-08-05',
  'anytime',
  true,
  periodic.templates_are_active,
  1
FROM periodic
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_task_templates AS existing
  WHERE existing.checklist_id = periodic.id
    AND existing.title = 'Clean TVs, fruit machine and jukebox'
);
