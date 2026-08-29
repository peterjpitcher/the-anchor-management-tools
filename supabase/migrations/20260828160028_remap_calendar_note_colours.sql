-- Move existing calendar notes onto the same accessible named palette used by
-- the rota and the shared events/dashboard calendar.
UPDATE public.calendar_notes
SET color = CASE UPPER(color)
  WHEN '#0EA5E9' THEN '#7DD3FC'
  WHEN '#F59E0B' THEN '#FACC15'
  ELSE color
END
WHERE UPPER(color) IN ('#0EA5E9', '#F59E0B');
