-- Adjust daily opening, closing and toilet checks; add weekly menu swaps
-- (owner decision 35, 2026-08-05).

UPDATE public.checklist_task_templates AS template
SET title = CASE template.title
      WHEN 'Hoover Carpet Area' THEN 'Hoover carpet area if needed'
      WHEN 'Final walk-round: no glasses or litter' THEN 'Check inside and outside areas are clean and tidy and empty ashtrays'
      WHEN 'Replace Table Numbers and Beer Mats' THEN 'Reset tables so they''re all ready to the right standard'
      WHEN 'Check Till for Bookings and Place Chalkboards' THEN 'Check the till for bookings and place chalkboards and highchairs'
      ELSE template.title
    END,
    sort_order = CASE template.title
      WHEN 'Whatsapp Pete if you need more menus (main, Sunday, Kids, etc).' THEN 7
      WHEN 'Load ice bucket' THEN 8
      WHEN 'Load candles into holders and light at open' THEN 21
      ELSE template.sort_order
    END,
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title IN (
    'Hoover Carpet Area',
    'Final walk-round: no glasses or litter',
    'Replace Table Numbers and Beer Mats',
    'Check Till for Bookings and Place Chalkboards',
    'Whatsapp Pete if you need more menus (main, Sunday, Kids, etc).',
    'Load ice bucket',
    'Load candles into holders and light at open'
  );

DELETE FROM public.checklist_task_templates AS template
USING public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title IN (
    'Utensils out (tongs / measures / cocktail equip)',
    'Empty ashtrays'
  )
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
  AND checklist.name = 'Bar Opening'
  AND checklist.department = 'bar'
  AND template.title IN (
    'Utensils out (tongs / measures / cocktail equip)',
    'Empty ashtrays'
  );

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
), new_tasks(title, sort_order, frequency, weekday, anchor_date) AS (
  VALUES
    ('Menus are in the holder ready', 6, 'daily', NULL::integer, NULL::date),
    ('Switch weekday menus for Sunday menus from caddy drawer', 22, 'weekly', 0, DATE '2026-08-09'),
    ('Switch Sunday menus for weekday menus from caddy drawer', 23, 'weekly', 2, DATE '2026-08-11')
)
INSERT INTO public.checklist_task_templates
  (checklist_id, title, sort_order, schedule_kind, freq, by_weekday,
   anchor_date, anchor, is_spot_checkable, is_active, version)
SELECT
  opening.id,
  new_tasks.title,
  new_tasks.sort_order,
  'calendar',
  new_tasks.frequency,
  CASE WHEN new_tasks.weekday IS NULL THEN NULL ELSE ARRAY[new_tasks.weekday] END,
  new_tasks.anchor_date,
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

UPDATE public.checklist_task_templates AS template
SET instruction = 'Regular Cleaning Check Points: Toilet (including toilet rolls and paper towels in holders, handwash topped up, sinks and toilets sprayed and wiped if required, and floor mopped if needed), Jukebox, Pool Table, Fruit Machine, Till and door push plates.',
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Cleaning Checks'
  AND checklist.department = 'bar'
  -- The seed created this task as 'Cleaning check', but it was renamed to
  -- 'Bathroom Check/Freshen' in the live data outside of any migration. Matching only
  -- the seeded title made this statement a silent no-op against production, so both
  -- names are accepted.
  AND template.title IN ('Cleaning check', 'Bathroom Check/Freshen');

UPDATE public.checklist_task_templates AS template
SET title = 'Clean all tables and remove beer mats (throw out dirty mats)',
    version = template.version + 1,
    updated_at = now()
FROM public.checklists AS checklist
WHERE template.checklist_id = checklist.id
  AND checklist.name = 'Bar Closing'
  AND checklist.department = 'bar'
  AND template.title = 'All tables clean and beer mats removed (dispose of rubbish ones)';
