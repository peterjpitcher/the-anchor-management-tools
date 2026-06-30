-- Append-only internal notes per recruitment candidate.
-- Timestamped + attributed; mirrors the recruitment RLS pattern. No UPDATE/DELETE
-- policy is defined, so notes are immutable at the database layer (append-only).
CREATE TABLE IF NOT EXISTS public.recruitment_candidate_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.recruitment_applications(id) ON DELETE SET NULL,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  created_by uuid REFERENCES auth.users(id),
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_candidate_notes_candidate
  ON public.recruitment_candidate_notes (candidate_id, created_at DESC);

ALTER TABLE public.recruitment_candidate_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment read access" ON public.recruitment_candidate_notes
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'recruitment', 'view'));

CREATE POLICY "Recruitment create access" ON public.recruitment_candidate_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'recruitment', 'edit'));

CREATE POLICY "Service role manages recruitment notes" ON public.recruitment_candidate_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
