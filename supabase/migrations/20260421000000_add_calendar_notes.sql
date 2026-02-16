-- Calendar notes for manual/AI-generated important dates shown on app calendars

CREATE TABLE IF NOT EXISTS public.calendar_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_date date NOT NULL,
  title text NOT NULL,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  start_time time without time zone,
  end_time time without time zone,
  color text NOT NULL DEFAULT '#0EA5E9',
  generated_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT calendar_notes_source_check CHECK (source IN ('manual', 'ai')),
  CONSTRAINT calendar_notes_title_not_blank CHECK (char_length(btrim(title)) > 0),
  CONSTRAINT calendar_notes_color_hex_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_note_date
  ON public.calendar_notes (note_date);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_source_note_date
  ON public.calendar_notes (source, note_date);

ALTER TABLE public.calendar_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users with events view permission can view calendar notes" ON public.calendar_notes;
CREATE POLICY "Users with events view permission can view calendar notes"
  ON public.calendar_notes
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'events', 'view') OR
    public.user_has_permission(auth.uid(), 'settings', 'manage')
  );

DROP POLICY IF EXISTS "Users with settings manage permission can create calendar notes" ON public.calendar_notes;
CREATE POLICY "Users with settings manage permission can create calendar notes"
  ON public.calendar_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'settings', 'manage'));

DROP POLICY IF EXISTS "Users with settings manage permission can update calendar notes" ON public.calendar_notes;
CREATE POLICY "Users with settings manage permission can update calendar notes"
  ON public.calendar_notes
  FOR UPDATE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'settings', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'settings', 'manage'));

DROP POLICY IF EXISTS "Users with settings manage permission can delete calendar notes" ON public.calendar_notes;
CREATE POLICY "Users with settings manage permission can delete calendar notes"
  ON public.calendar_notes
  FOR DELETE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'settings', 'manage'));

DROP TRIGGER IF EXISTS update_calendar_notes_updated_at ON public.calendar_notes;
CREATE TRIGGER update_calendar_notes_updated_at
  BEFORE UPDATE ON public.calendar_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
