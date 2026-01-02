-- Hiring screening runs, deterministic scoring fields, parsing status

-- 1) Screening runs table
CREATE TABLE IF NOT EXISTS public.hiring_screening_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.hiring_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.hiring_candidates(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.hiring_jobs(id) ON DELETE CASCADE,
  run_type text NOT NULL DEFAULT 'auto',
  run_reason text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  model text,
  temperature numeric,
  prompt_version text,
  job_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rubric_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  screener_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_raw integer,
  recommendation_raw text,
  score_calibrated integer,
  recommendation_calibrated text,
  confidence numeric,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  experience_analysis text,
  draft_replies jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiring_screening_runs_application
  ON public.hiring_screening_runs (application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hiring_screening_runs_candidate
  ON public.hiring_screening_runs (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hiring_screening_runs_job
  ON public.hiring_screening_runs (job_id, created_at DESC);

-- 2) Application screening fields
ALTER TABLE public.hiring_applications
  ADD COLUMN IF NOT EXISTS screening_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS screening_error text,
  ADD COLUMN IF NOT EXISTS latest_screening_run_id uuid REFERENCES public.hiring_screening_runs(id),
  ADD COLUMN IF NOT EXISTS ai_score_raw integer,
  ADD COLUMN IF NOT EXISTS ai_recommendation_raw text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS screening_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_reviewed_by uuid REFERENCES auth.users(id);

-- 3) Candidate parsing fields
ALTER TABLE public.hiring_candidates
  ADD COLUMN IF NOT EXISTS parsing_status text,
  ADD COLUMN IF NOT EXISTS parsing_error text,
  ADD COLUMN IF NOT EXISTS parsing_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_text text;

-- 4) Updated_at trigger for screening runs
DROP TRIGGER IF EXISTS trg_hiring_screening_runs_updated_at ON public.hiring_screening_runs;
CREATE TRIGGER trg_hiring_screening_runs_updated_at
  BEFORE UPDATE ON public.hiring_screening_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5) Enable RLS + policies
ALTER TABLE public.hiring_screening_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hiring screening runs read" ON public.hiring_screening_runs;
DROP POLICY IF EXISTS "Hiring screening runs manage" ON public.hiring_screening_runs;

CREATE POLICY "Hiring screening runs read" ON public.hiring_screening_runs
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring screening runs manage" ON public.hiring_screening_runs
  FOR ALL TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

