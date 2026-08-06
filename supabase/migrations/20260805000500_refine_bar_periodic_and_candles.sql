-- Simplify duplicate periodic tasks and update frequencies (owner decision 33,
-- 2026-08-05). Templates with history are deactivated rather than deleted so
-- completed checklist records retain their foreign-key references.

UPDATE public.checklist_task_templates AS template
SET interval_days = 3,
    tolerance_days = 1,
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Periodic'
  AND checklist.department = 'bar'
  AND template.title = 'Clean glass racks';

UPDATE public.checklist_task_templates AS template
SET title = 'Clean window seals',
    interval_days = 2,
    tolerance_days = 1,
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Periodic'
  AND checklist.department = 'bar'
  AND template.title = 'Window seals and windows';

UPDATE public.checklist_task_templates AS template
SET season_start = '09-01',
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title = 'Load candles into holders and light at open';

DELETE FROM public.checklist_task_templates AS template
USING public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Periodic'
  AND checklist.department = 'bar'
  AND template.title IN ('Stock rotation', 'Refill caddies', 'Glass clean jukebox', 'Hoover/mop')
  AND NOT EXISTS (
    SELECT 1
    FROM public.checklist_task_instances AS instance
    WHERE instance.template_id = template.id
  );

UPDATE public.checklist_task_templates AS template
SET is_active = false,
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Periodic'
  AND checklist.department = 'bar'
  AND template.title IN ('Stock rotation', 'Refill caddies', 'Glass clean jukebox', 'Hoover/mop');
