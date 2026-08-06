-- Narrow three overlapping checklist tasks (owner decision 34, 2026-08-05).

UPDATE public.checklist_task_templates AS template
SET title = CASE template.title
      WHEN 'Wipe chairs and tables' THEN 'Wipe chairs and table legs'
      WHEN 'Restock fridges snacks bottles and rotate' THEN 'Rotate fridge and bottle stock'
    END,
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Periodic'
  AND checklist.department = 'bar'
  AND template.title IN (
    'Wipe chairs and tables',
    'Restock fridges snacks bottles and rotate'
  );

UPDATE public.checklist_task_templates AS template
SET title = 'Final walk-round: no glasses or litter',
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title = 'Make sure all spaces (inside and out) are clean and tidy (cigarette butts, glasses, etc)';
