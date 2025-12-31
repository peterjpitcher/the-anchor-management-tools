-- Hiring M0 schema extensions: data model, RLS, and storage alignment

-- 1. Extend job templates and jobs with structured config
ALTER TABLE public.hiring_job_templates
  ADD COLUMN IF NOT EXISTS screening_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS screening_rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS message_templates jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS compliance_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.hiring_jobs
  ADD COLUMN IF NOT EXISTS prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS screening_rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS message_templates jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS compliance_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Candidate schema enhancements
ALTER TABLE public.hiring_candidates
  ADD COLUMN IF NOT EXISTS secondary_emails text[] NOT NULL DEFAULT '{}'::text[];

-- 3. Application outcome fields
ALTER TABLE public.hiring_applications
  ADD COLUMN IF NOT EXISTS outcome_status text,
  ADD COLUMN IF NOT EXISTS outcome_reason text,
  ADD COLUMN IF NOT EXISTS outcome_notes text,
  ADD COLUMN IF NOT EXISTS outcome_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_recorded_by uuid REFERENCES auth.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hiring_applications_outcome_status_check'
  ) THEN
    ALTER TABLE public.hiring_applications
      ADD CONSTRAINT hiring_applications_outcome_status_check
      CHECK (
        outcome_status IS NULL
        OR outcome_status IN ('hired', 'rejected', 'withdrawn', 'offer_declined', 'no_show')
      );
  END IF;
END $$;

-- 4. Notes updated_at
ALTER TABLE public.hiring_notes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 5. Candidate documents and profile versions
CREATE TABLE IF NOT EXISTS public.hiring_candidate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.hiring_candidates(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  source text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiring_candidate_documents_candidate
  ON public.hiring_candidate_documents (candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.hiring_candidate_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.hiring_candidates(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.hiring_candidate_documents(id) ON DELETE SET NULL,
  version_number integer NOT NULL,
  parsed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  diff_summary text,
  diff_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_hiring_candidate_profile_versions_candidate
  ON public.hiring_candidate_profile_versions (candidate_id, created_at DESC);

ALTER TABLE public.hiring_candidates
  ADD COLUMN IF NOT EXISTS current_profile_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hiring_candidates_current_profile_version_fkey'
  ) THEN
    ALTER TABLE public.hiring_candidates
      ADD CONSTRAINT hiring_candidates_current_profile_version_fkey
      FOREIGN KEY (current_profile_version_id)
      REFERENCES public.hiring_candidate_profile_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 6. Candidate activity (repeat applicant tracking)
CREATE TABLE IF NOT EXISTS public.hiring_candidate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.hiring_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.hiring_applications(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.hiring_jobs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiring_candidate_events_candidate
  ON public.hiring_candidate_events (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hiring_candidate_events_application
  ON public.hiring_candidate_events (application_id);

-- 7. Application communications log
CREATE TABLE IF NOT EXISTS public.hiring_application_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.hiring_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.hiring_candidates(id) ON DELETE CASCADE,
  channel text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL DEFAULT 'draft',
  subject text,
  body text,
  template_key text,
  sent_via text,
  sent_at timestamptz,
  sent_by uuid REFERENCES auth.users(id),
  external_reference text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiring_application_messages_direction_check
    CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT hiring_application_messages_status_check
    CHECK (status IN ('draft', 'sent', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_hiring_application_messages_application
  ON public.hiring_application_messages (application_id, created_at DESC);

-- 8. AI override logs
CREATE TABLE IF NOT EXISTS public.hiring_application_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.hiring_applications(id) ON DELETE CASCADE,
  override_type text NOT NULL,
  previous_score integer,
  new_score integer,
  previous_recommendation text,
  new_recommendation text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiring_application_overrides_application
  ON public.hiring_application_overrides (application_id, created_at DESC);

-- 9. Interview scheduling tables
CREATE TABLE IF NOT EXISTS public.hiring_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.hiring_applications(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  end_at timestamptz,
  duration_minutes integer,
  location text,
  calendar_event_id text,
  calendar_event_url text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiring_interviews_application
  ON public.hiring_interviews (application_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS public.hiring_interview_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.hiring_interviews(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text,
  email text,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiring_interview_attendees_role_check
    CHECK (role IN ('candidate', 'interviewer', 'observer'))
);

CREATE INDEX IF NOT EXISTS idx_hiring_interview_attendees_interview
  ON public.hiring_interview_attendees (interview_id);

-- 10. Enable RLS on new tables
ALTER TABLE public.hiring_candidate_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_candidate_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_candidate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_application_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_application_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_interview_attendees ENABLE ROW LEVEL SECURITY;

-- 11. Update updated_at triggers for hiring tables
DROP TRIGGER IF EXISTS trg_hiring_job_templates_updated_at ON public.hiring_job_templates;
CREATE TRIGGER trg_hiring_job_templates_updated_at
  BEFORE UPDATE ON public.hiring_job_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_jobs_updated_at ON public.hiring_jobs;
CREATE TRIGGER trg_hiring_jobs_updated_at
  BEFORE UPDATE ON public.hiring_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_candidates_updated_at ON public.hiring_candidates;
CREATE TRIGGER trg_hiring_candidates_updated_at
  BEFORE UPDATE ON public.hiring_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_applications_updated_at ON public.hiring_applications;
CREATE TRIGGER trg_hiring_applications_updated_at
  BEFORE UPDATE ON public.hiring_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_notes_updated_at ON public.hiring_notes;
CREATE TRIGGER trg_hiring_notes_updated_at
  BEFORE UPDATE ON public.hiring_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_candidate_documents_updated_at ON public.hiring_candidate_documents;
CREATE TRIGGER trg_hiring_candidate_documents_updated_at
  BEFORE UPDATE ON public.hiring_candidate_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_candidate_profile_versions_updated_at ON public.hiring_candidate_profile_versions;
CREATE TRIGGER trg_hiring_candidate_profile_versions_updated_at
  BEFORE UPDATE ON public.hiring_candidate_profile_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_candidate_events_updated_at ON public.hiring_candidate_events;
CREATE TRIGGER trg_hiring_candidate_events_updated_at
  BEFORE UPDATE ON public.hiring_candidate_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_application_messages_updated_at ON public.hiring_application_messages;
CREATE TRIGGER trg_hiring_application_messages_updated_at
  BEFORE UPDATE ON public.hiring_application_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_application_overrides_updated_at ON public.hiring_application_overrides;
CREATE TRIGGER trg_hiring_application_overrides_updated_at
  BEFORE UPDATE ON public.hiring_application_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_interviews_updated_at ON public.hiring_interviews;
CREATE TRIGGER trg_hiring_interviews_updated_at
  BEFORE UPDATE ON public.hiring_interviews
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_hiring_interview_attendees_updated_at ON public.hiring_interview_attendees;
CREATE TRIGGER trg_hiring_interview_attendees_updated_at
  BEFORE UPDATE ON public.hiring_interview_attendees
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 12. Replace permissive hiring RLS policies with permission-aware ones
DROP POLICY IF EXISTS "Staff can view templates" ON public.hiring_job_templates;
DROP POLICY IF EXISTS "Staff can manage templates" ON public.hiring_job_templates;
DROP POLICY IF EXISTS "Public read open jobs" ON public.hiring_jobs;
DROP POLICY IF EXISTS "Staff manage jobs" ON public.hiring_jobs;
DROP POLICY IF EXISTS "Staff view candidates" ON public.hiring_candidates;
DROP POLICY IF EXISTS "Insert candidates" ON public.hiring_candidates;
DROP POLICY IF EXISTS "Staff update candidates" ON public.hiring_candidates;
DROP POLICY IF EXISTS "Staff view applications" ON public.hiring_applications;
DROP POLICY IF EXISTS "Insert applications" ON public.hiring_applications;
DROP POLICY IF EXISTS "Staff update applications" ON public.hiring_applications;
DROP POLICY IF EXISTS "Staff manage notes" ON public.hiring_notes;

-- Job templates
CREATE POLICY "Hiring templates read" ON public.hiring_job_templates
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring templates manage" ON public.hiring_job_templates
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'hiring', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'hiring', 'manage'));

-- Jobs
CREATE POLICY "Hiring jobs public read" ON public.hiring_jobs
  FOR SELECT TO anon
  USING (status = 'open');

CREATE POLICY "Hiring jobs read" ON public.hiring_jobs
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring jobs create" ON public.hiring_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'create')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring jobs update" ON public.hiring_jobs
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring jobs delete" ON public.hiring_jobs
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Candidates
CREATE POLICY "Hiring candidates read" ON public.hiring_candidates
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidates create" ON public.hiring_candidates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'create')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidates update" ON public.hiring_candidates
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidates delete" ON public.hiring_candidates
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Applications
CREATE POLICY "Hiring applications read" ON public.hiring_applications
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring applications create" ON public.hiring_applications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'create')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring applications update" ON public.hiring_applications
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring applications delete" ON public.hiring_applications
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Notes
CREATE POLICY "Hiring notes read" ON public.hiring_notes
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring notes create" ON public.hiring_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring notes update" ON public.hiring_notes
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring notes delete" ON public.hiring_notes
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Candidate documents
CREATE POLICY "Hiring candidate documents read" ON public.hiring_candidate_documents
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate documents create" ON public.hiring_candidate_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'create')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate documents update" ON public.hiring_candidate_documents
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate documents delete" ON public.hiring_candidate_documents
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Candidate profile versions
CREATE POLICY "Hiring candidate profiles read" ON public.hiring_candidate_profile_versions
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate profiles create" ON public.hiring_candidate_profile_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'create')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate profiles update" ON public.hiring_candidate_profile_versions
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate profiles delete" ON public.hiring_candidate_profile_versions
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Candidate events
CREATE POLICY "Hiring candidate events read" ON public.hiring_candidate_events
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate events create" ON public.hiring_candidate_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'create')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate events update" ON public.hiring_candidate_events
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring candidate events delete" ON public.hiring_candidate_events
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Application messages
CREATE POLICY "Hiring application messages read" ON public.hiring_application_messages
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring application messages create" ON public.hiring_application_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring application messages update" ON public.hiring_application_messages
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring application messages delete" ON public.hiring_application_messages
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Application overrides
CREATE POLICY "Hiring application overrides read" ON public.hiring_application_overrides
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring application overrides create" ON public.hiring_application_overrides
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring application overrides update" ON public.hiring_application_overrides
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring application overrides delete" ON public.hiring_application_overrides
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Interviews
CREATE POLICY "Hiring interviews read" ON public.hiring_interviews
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring interviews create" ON public.hiring_interviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring interviews update" ON public.hiring_interviews
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring interviews delete" ON public.hiring_interviews
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- Interview attendees
CREATE POLICY "Hiring interview attendees read" ON public.hiring_interview_attendees
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring interview attendees create" ON public.hiring_interview_attendees
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring interview attendees update" ON public.hiring_interview_attendees
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'edit')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring interview attendees delete" ON public.hiring_interview_attendees
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'delete')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

-- 13. CV storage bucket (public for now to match existing flow)
INSERT INTO storage.buckets (id, name, public)
VALUES ('hiring-docs', 'hiring-docs', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- 14. Reconcile employee status constraint with current app values
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.employees'::regclass
      AND conname LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE public.employees DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

UPDATE public.employees
SET status = 'Former'
WHERE status IN ('Inactive', 'Suspended');

ALTER TABLE public.employees
  ADD CONSTRAINT employees_status_check
  CHECK (status IN ('Active', 'Former', 'Prospective'));
