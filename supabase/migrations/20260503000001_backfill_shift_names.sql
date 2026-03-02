-- Backfill name on existing shifts from their linked template
UPDATE rota_shifts s
SET name = t.name
FROM rota_shift_templates t
WHERE s.template_id = t.id
  AND s.name IS NULL;
