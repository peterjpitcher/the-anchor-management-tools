-- Add end_date to support multi-day calendar notes

ALTER TABLE IF EXISTS public.calendar_notes
  ADD COLUMN IF NOT EXISTS end_date date;

UPDATE public.calendar_notes
SET end_date = note_date
WHERE end_date IS NULL;

ALTER TABLE IF EXISTS public.calendar_notes
  DROP CONSTRAINT IF EXISTS calendar_notes_date_range_check;

ALTER TABLE IF EXISTS public.calendar_notes
  ADD CONSTRAINT calendar_notes_date_range_check
  CHECK (end_date IS NULL OR end_date >= note_date);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_note_date_end_date
  ON public.calendar_notes (note_date, end_date);
