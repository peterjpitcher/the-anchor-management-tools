-- Import a single 2026 event placeholder in draft state

INSERT INTO public.events (name, date, time, end_time, event_status, slug)
SELECT
  'World Cup 2026: England vs Croatia (Group Stage)',
  '2026-06-17'::date,
  '20:00',
  '22:30'::time,
  'draft',
  'world-cup-2026-england-vs-croatia-group-stage-2026-06-17'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.events
  WHERE slug = 'world-cup-2026-england-vs-croatia-group-stage-2026-06-17'
);
