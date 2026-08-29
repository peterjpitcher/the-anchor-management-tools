-- Apply the standard rota colour rules to existing shift templates.
UPDATE public.rota_shift_templates
SET colour = CASE
  WHEN lower(trim(department)) LIKE '%runner%' THEN '#9333EA'
  WHEN lower(trim(department)) LIKE '%training%' THEN '#16A34A'
  WHEN lower(trim(department)) LIKE '%host%' THEN '#111827'
  WHEN lower(trim(department)) LIKE '%clean%' THEN '#FFFFFF'
  WHEN lower(trim(department)) LIKE '%bar%' AND start_time = TIME '12:00' THEN '#7DD3FC'
  WHEN lower(trim(department)) LIKE '%bar%' AND start_time >= TIME '16:00' THEN '#1E3A8A'
  WHEN lower(trim(department)) LIKE '%kitchen%' AND start_time < TIME '16:00' THEN '#FACC15'
  WHEN lower(trim(department)) LIKE '%kitchen%' AND start_time >= TIME '16:00' THEN '#F97316'
  ELSE colour
END
WHERE lower(trim(department)) LIKE '%runner%'
   OR lower(trim(department)) LIKE '%training%'
   OR lower(trim(department)) LIKE '%host%'
   OR lower(trim(department)) LIKE '%clean%'
   OR (lower(trim(department)) LIKE '%bar%' AND (start_time = TIME '12:00' OR start_time >= TIME '16:00'))
   OR lower(trim(department)) LIKE '%kitchen%';
