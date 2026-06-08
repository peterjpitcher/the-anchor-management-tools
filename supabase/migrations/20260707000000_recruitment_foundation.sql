-- Recruitment ATS foundation: schema, RBAC, storage, cleanup, and transactional helpers.

BEGIN;

-- ---------------------------------------------------------------------------
-- Legacy hiring cleanup
-- ---------------------------------------------------------------------------

DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.module_name = 'hiring';

DELETE FROM public.permissions
WHERE module_name = 'hiring';

DELETE FROM public.system_settings
WHERE key IN ('hiring_retention_policy', 'hiring_stage_reminders');

-- ---------------------------------------------------------------------------
-- Storage and employee attachment prerequisite
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recruitment-cvs',
  'recruitment-cvs',
  FALSE,
  10485760,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO public.attachment_categories (category_name, email_on_upload)
SELECT 'CV', FALSE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.attachment_categories
  WHERE lower(category_name) = 'cv'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can view recruitment CVs'
  ) THEN
    CREATE POLICY "Authenticated users can view recruitment CVs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'recruitment-cvs'
      AND public.user_has_permission(auth.uid(), 'recruitment', 'view')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload recruitment CVs'
  ) THEN
    CREATE POLICY "Authenticated users can upload recruitment CVs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'recruitment-cvs'
      AND public.user_has_permission(auth.uid(), 'recruitment', 'create')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete recruitment CVs'
  ) THEN
    CREATE POLICY "Authenticated users can delete recruitment CVs"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'recruitment-cvs'
      AND public.user_has_permission(auth.uid(), 'recruitment', 'delete')
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Recruitment permissions
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (module_name, action, description)
VALUES
  ('recruitment', 'view', 'View recruitment dashboard, postings, candidates, applications, appointments, and communications'),
  ('recruitment', 'create', 'Create recruitment postings, candidates, applications, and appointment slots'),
  ('recruitment', 'edit', 'Edit recruitment postings, candidates, applications, and appointments'),
  ('recruitment', 'manage', 'Manage recruitment settings, AI re-runs, talent-pool matching, and retention operations'),
  ('recruitment', 'send', 'Send recruitment emails and SMS reminders'),
  ('recruitment', 'delete', 'Erase recruitment candidate PII and destructive recruitment records')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_role_id uuid;
  v_permission_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'super_admin';

  IF v_role_id IS NOT NULL THEN
    FOR v_permission_id IN
      SELECT id FROM public.permissions WHERE module_name = 'recruitment'
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_permission_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE name = 'manager';

  IF v_role_id IS NOT NULL THEN
    FOR v_permission_id IN
      SELECT id
      FROM public.permissions
      WHERE module_name = 'recruitment'
        AND action IN ('view', 'create', 'edit', 'manage', 'send')
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_permission_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
END $$;

INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'recruitment_retention_policy',
  '{"action":"anonymize","retention_months":12}'::jsonb,
  'Recruitment retention policy for terminal non-hired candidates.',
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recruitment_job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  role_type text NOT NULL CHECK (role_type IN ('bar', 'kitchen', 'either', 'management', 'other')),
  description text NOT NULL,
  requirements text NOT NULL,
  ai_scoring_notes text,
  employment_type text NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'casual')),
  positions_available integer NOT NULL DEFAULT 1 CHECK (positions_available > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  is_public boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recruitment_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  email_normalized text GENERATED ALWAYS AS (lower(email)) STORED,
  phone text,
  phone_e164 text,
  location text,
  source text NOT NULL CHECK (source IN ('website', 'manual_upload', 'referral', 'job_board', 'other')),
  cv_file_path text,
  cv_file_name text,
  cv_mime_type text,
  cv_file_size_bytes integer,
  cv_text text,
  cv_extraction_status text NOT NULL DEFAULT 'no_cv' CHECK (cv_extraction_status IN ('pending', 'done', 'failed', 'unsupported', 'no_cv')),
  provided_details text,
  extracted_data jsonb,
  cv_summary text,
  right_to_work_status text NOT NULL DEFAULT 'not_checked' CHECK (right_to_work_status IN ('not_checked', 'pending', 'verified', 'failed')),
  right_to_work_document_type text CHECK (
    right_to_work_document_type IS NULL
    OR right_to_work_document_type IN ('Passport', 'Biometric Residence Permit', 'Share Code', 'Other', 'List A', 'List B')
  ),
  right_to_work_checked_at timestamptz,
  right_to_work_checked_by uuid REFERENCES auth.users(id),
  consent_source text,
  consent_at timestamptz,
  privacy_notice_version text,
  sms_consent boolean NOT NULL DEFAULT false,
  sms_consent_at timestamptz,
  future_recruitment_consent boolean NOT NULL DEFAULT false,
  future_recruitment_consent_at timestamptz,
  retention_until date,
  anonymised_at timestamptz,
  converted_employee_id uuid REFERENCES public.employees(employee_id),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruitment_candidates_email_required_active
    CHECK (anonymised_at IS NOT NULL OR email IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_candidates_active_email
  ON public.recruitment_candidates (email_normalized)
  WHERE email IS NOT NULL AND anonymised_at IS NULL;

CREATE TABLE IF NOT EXISTS public.recruitment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  job_posting_id uuid REFERENCES public.recruitment_job_postings(id) ON DELETE SET NULL,
  is_general boolean GENERATED ALWAYS AS (job_posting_id IS NULL) STORED,
  status text NOT NULL CHECK (
    status IN (
      'new',
      'ai_screened',
      'shortlisted',
      'interview_invited',
      'interview_scheduled',
      'interviewed',
      'trial_offered',
      'trial_scheduled',
      'trial_completed',
      'offered',
      'hired',
      'talent_pool',
      'rejected',
      'withdrawn',
      'on_hold',
      'declined_duplicate'
    )
  ),
  source text NOT NULL CHECK (source IN ('website', 'manual_upload', 'referral', 'job_board', 'other')),
  availability jsonb,
  cover_note text,
  relevant_experience_answer text,
  travel_answer text,
  start_availability text,
  latest_ai_run_id uuid,
  ai_score integer CHECK (ai_score IS NULL OR ai_score BETWEEN 0 AND 100),
  ai_recommendation text CHECK (ai_recommendation IS NULL OR ai_recommendation IN ('reject', 'review', 'fast_track')),
  ai_rationale text,
  ai_strengths jsonb,
  ai_concerns jsonb,
  ai_flags jsonb,
  ai_model text,
  ai_scored_at timestamptz,
  ai_scored_against_version integer,
  booking_token_hash text,
  booking_token_type text CHECK (booking_token_type IS NULL OR booking_token_type IN ('interview', 'trial_shift')),
  booking_token_expires_at timestamptz,
  booking_token_used_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  duplicate_of_application_id uuid REFERENCES public.recruitment_applications(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recruitment_application_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.recruitment_applications(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  note text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recruitment_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL CHECK (operation IN ('cv_extraction', 'application_scoring', 'email_draft')),
  candidate_id uuid REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.recruitment_applications(id) ON DELETE CASCADE,
  job_posting_id uuid REFERENCES public.recruitment_job_postings(id) ON DELETE SET NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  recommendation text,
  structured_output jsonb,
  raw_response jsonb,
  error_message text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost numeric(12,6),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recruitment_applications
  DROP CONSTRAINT IF EXISTS recruitment_applications_latest_ai_run_id_fkey;

ALTER TABLE public.recruitment_applications
  ADD CONSTRAINT recruitment_applications_latest_ai_run_id_fkey
  FOREIGN KEY (latest_ai_run_id)
  REFERENCES public.recruitment_ai_runs(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.recruitment_appointment_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('interview', 'trial_shift')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/London',
  location text NOT NULL DEFAULT 'The Anchor',
  interviewer_user_id uuid REFERENCES auth.users(id),
  supervisor_staff_id uuid REFERENCES public.employees(employee_id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'booked', 'cancelled')),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity = 1),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruitment_appointment_slots_time_check CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.recruitment_candidate_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.recruitment_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES public.recruitment_appointment_slots(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('interview', 'trial_shift')),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/London',
  location text NOT NULL,
  supervisor_staff_id uuid REFERENCES public.employees(employee_id),
  status text NOT NULL CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled', 'rescheduled')),
  calendar_event_id text,
  calendar_sync_status text NOT NULL DEFAULT 'pending' CHECK (calendar_sync_status IN ('pending', 'synced', 'failed', 'ics_fallback')),
  calendar_last_error text,
  booking_token_hash text,
  token_expires_at timestamptz,
  reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  reminder_email_sent_at timestamptz,
  reminder_sms_sent_at timestamptz,
  outcome text,
  outcome_rating integer CHECK (outcome_rating IS NULL OR outcome_rating BETWEEN 1 AND 5),
  meal_provided boolean NOT NULL DEFAULT false,
  outcome_recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruitment_candidate_appointments_time_check CHECK (scheduled_end > scheduled_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_candidate_appointments_token_hash
  ON public.recruitment_candidate_appointments (booking_token_hash)
  WHERE booking_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.recruitment_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (
    type IN (
      'interview_invite',
      'rejection',
      'already_considered',
      'trial_invite',
      'offer',
      'interview_confirmation',
      'trial_confirmation',
      'reminder',
      'manager_alert'
    )
  ),
  subject text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_email_templates_active_type
  ON public.recruitment_email_templates (type)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.recruitment_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.recruitment_applications(id) ON DELETE SET NULL,
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  subject text,
  final_body text NOT NULL,
  was_ai_assisted boolean NOT NULL DEFAULT false,
  ai_run_id uuid REFERENCES public.recruitment_ai_runs(id) ON DELETE SET NULL,
  edited_by uuid REFERENCES auth.users(id),
  sent_by uuid REFERENCES auth.users(id),
  sent_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued', 'sent', 'failed', 'bounced', 'suppressed')),
  provider text,
  provider_message_id text,
  idempotency_key text UNIQUE,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_recruitment_job_postings_public
  ON public.recruitment_job_postings (status, is_public, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_applications_candidate
  ON public.recruitment_applications (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_applications_posting_status
  ON public.recruitment_applications (job_posting_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_applications_booking_token_hash
  ON public.recruitment_applications (booking_token_hash)
  WHERE booking_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recruitment_status_events_application
  ON public.recruitment_application_status_events (application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_ai_runs_application
  ON public.recruitment_ai_runs (application_id, operation, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_appointment_slots_open
  ON public.recruitment_appointment_slots (type, starts_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_recruitment_candidate_appointments_application
  ON public.recruitment_candidate_appointments (application_id, scheduled_start DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_candidate_appointments_reminders
  ON public.recruitment_candidate_appointments (scheduled_start)
  WHERE status = 'scheduled'
    AND (reminder_email_sent_at IS NULL OR reminder_sms_sent_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_recruitment_communications_candidate
  ON public.recruitment_communications (candidate_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_recruitment_job_postings_updated_at ON public.recruitment_job_postings;
CREATE TRIGGER trg_recruitment_job_postings_updated_at
  BEFORE UPDATE ON public.recruitment_job_postings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_candidates_updated_at ON public.recruitment_candidates;
CREATE TRIGGER trg_recruitment_candidates_updated_at
  BEFORE UPDATE ON public.recruitment_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_applications_updated_at ON public.recruitment_applications;
CREATE TRIGGER trg_recruitment_applications_updated_at
  BEFORE UPDATE ON public.recruitment_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_application_status_events_updated_at ON public.recruitment_application_status_events;
CREATE TRIGGER trg_recruitment_application_status_events_updated_at
  BEFORE UPDATE ON public.recruitment_application_status_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_ai_runs_updated_at ON public.recruitment_ai_runs;
CREATE TRIGGER trg_recruitment_ai_runs_updated_at
  BEFORE UPDATE ON public.recruitment_ai_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_appointment_slots_updated_at ON public.recruitment_appointment_slots;
CREATE TRIGGER trg_recruitment_appointment_slots_updated_at
  BEFORE UPDATE ON public.recruitment_appointment_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_candidate_appointments_updated_at ON public.recruitment_candidate_appointments;
CREATE TRIGGER trg_recruitment_candidate_appointments_updated_at
  BEFORE UPDATE ON public.recruitment_candidate_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_email_templates_updated_at ON public.recruitment_email_templates;
CREATE TRIGGER trg_recruitment_email_templates_updated_at
  BEFORE UPDATE ON public.recruitment_email_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_recruitment_communications_updated_at ON public.recruitment_communications;
CREATE TRIGGER trg_recruitment_communications_updated_at
  BEFORE UPDATE ON public.recruitment_communications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.recruitment_job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_application_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_appointment_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_candidate_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_communications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recruitment_job_postings',
    'recruitment_candidates',
    'recruitment_applications',
    'recruitment_application_status_events',
    'recruitment_ai_runs',
    'recruitment_appointment_slots',
    'recruitment_candidate_appointments',
    'recruitment_email_templates',
    'recruitment_communications'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Recruitment read access" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Recruitment create access" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Recruitment edit access" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Recruitment delete access" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Service role manages recruitment" ON public.%I', table_name);

    EXECUTE format(
      'CREATE POLICY "Recruitment read access" ON public.%I FOR SELECT TO authenticated USING (public.user_has_permission(auth.uid(), ''recruitment'', ''view''))',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY "Recruitment create access" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.user_has_permission(auth.uid(), ''recruitment'', ''create''))',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY "Recruitment edit access" ON public.%I FOR UPDATE TO authenticated USING (public.user_has_permission(auth.uid(), ''recruitment'', ''edit'') OR public.user_has_permission(auth.uid(), ''recruitment'', ''manage'')) WITH CHECK (public.user_has_permission(auth.uid(), ''recruitment'', ''edit'') OR public.user_has_permission(auth.uid(), ''recruitment'', ''manage''))',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY "Recruitment delete access" ON public.%I FOR DELETE TO authenticated USING (public.user_has_permission(auth.uid(), ''recruitment'', ''delete''))',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY "Service role manages recruitment" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END $$;

-- Public postings are intentionally readable without candidate data.
DROP POLICY IF EXISTS "Public can view open recruitment postings" ON public.recruitment_job_postings;
CREATE POLICY "Public can view open recruitment postings"
  ON public.recruitment_job_postings
  FOR SELECT
  TO anon
  USING (status = 'open' AND is_public = true);

-- ---------------------------------------------------------------------------
-- Transactional helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recruitment_transition_application_status(
  p_application_id uuid,
  p_to_status text,
  p_note text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.recruitment_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.recruitment_applications;
  v_from_status text;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NOT NULL
     AND NOT public.user_has_permission(v_user_id, 'recruitment', 'edit')
     AND NOT public.user_has_permission(v_user_id, 'recruitment', 'manage') THEN
    RAISE EXCEPTION 'Insufficient recruitment permissions';
  END IF;

  SELECT *
  INTO v_application
  FROM public.recruitment_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recruitment application not found';
  END IF;

  v_from_status := v_application.status;

  UPDATE public.recruitment_applications
  SET status = p_to_status,
      updated_at = now(),
      rejected_at = CASE WHEN p_to_status = 'rejected' THEN COALESCE(rejected_at, now()) ELSE rejected_at END
  WHERE id = p_application_id
  RETURNING * INTO v_application;

  INSERT INTO public.recruitment_application_status_events (
    application_id,
    from_status,
    to_status,
    changed_by,
    note,
    metadata
  )
  VALUES (
    p_application_id,
    v_from_status,
    p_to_status,
    v_user_id,
    p_note,
    p_metadata
  );

  RETURN v_application;
END;
$$;

CREATE OR REPLACE FUNCTION public.recruitment_claim_appointment_slot(
  p_slot_id uuid,
  p_application_id uuid,
  p_candidate_id uuid,
  p_booking_token_hash text,
  p_token_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.recruitment_appointment_slots;
  v_appointment_id uuid;
BEGIN
  UPDATE public.recruitment_appointment_slots
  SET status = 'booked',
      updated_at = now()
  WHERE id = p_slot_id
    AND status = 'open'
    AND starts_at > now()
  RETURNING * INTO v_slot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot is no longer available';
  END IF;

  INSERT INTO public.recruitment_candidate_appointments (
    application_id,
    candidate_id,
    slot_id,
    type,
    scheduled_start,
    scheduled_end,
    timezone,
    location,
    supervisor_staff_id,
    status,
    booking_token_hash,
    token_expires_at
  )
  VALUES (
    p_application_id,
    p_candidate_id,
    p_slot_id,
    v_slot.type,
    v_slot.starts_at,
    v_slot.ends_at,
    v_slot.timezone,
    v_slot.location,
    v_slot.supervisor_staff_id,
    'scheduled',
    p_booking_token_hash,
    p_token_expires_at
  )
  RETURNING id INTO v_appointment_id;

  PERFORM public.recruitment_transition_application_status(
    p_application_id,
    CASE WHEN v_slot.type = 'trial_shift' THEN 'trial_scheduled' ELSE 'interview_scheduled' END,
    'Candidate booked appointment',
    jsonb_build_object('slot_id', p_slot_id, 'appointment_id', v_appointment_id)
  );

  RETURN v_appointment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Default templates
-- ---------------------------------------------------------------------------

INSERT INTO public.recruitment_email_templates (type, subject, body, is_active)
VALUES
  ('interview_invite', 'Interview invitation - The Anchor', 'Hi {{first_name}},\n\nThanks for applying for {{role_title}} at The Anchor. We would like to invite you for an interview.\n\nPlease choose a time using this link: {{booking_link}}\n\nPlease bring proof of your right to work in the UK.\n\nBest,\nThe Anchor', true),
  ('rejection', 'Your application to The Anchor', 'Hi {{first_name}},\n\nThank you for applying to The Anchor. We have reviewed your application and will not be taking it further this time.\n\nWe appreciate your interest and wish you the best.\n\nBest,\nThe Anchor', true),
  ('already_considered', 'Your application to The Anchor', 'Hi {{first_name}},\n\nThank you for applying again for {{role_title}}. We have already considered you for this role and will not reconsider the same vacancy at this stage.\n\nBest,\nThe Anchor', true),
  ('trial_invite', 'Trial shift invitation - The Anchor', 'Hi {{first_name}},\n\nWe would like to invite you for a short unpaid trial shift at The Anchor. It is around 2 hours, alongside an existing team member, with a complimentary main-menu item and soft drink.\n\nPlease bring proof of your right to work in the UK. You cannot perform duties without this check.\n\nChoose a time here: {{booking_link}}\n\nBest,\nThe Anchor', true),
  ('offer', 'Offer to join The Anchor', 'Hi {{first_name}},\n\nWe would like to offer you the role of {{role_title}} at The Anchor. The agreed details are:\n\n{{offer_terms}}\n\nBest,\nThe Anchor', true),
  ('interview_confirmation', 'Interview confirmed - The Anchor', 'Hi {{first_name}},\n\nYour interview is confirmed for {{appointment_time}} at The Anchor.\n\nPlease bring proof of your right to work in the UK.\n\nBest,\nThe Anchor', true),
  ('trial_confirmation', 'Trial shift confirmed - The Anchor', 'Hi {{first_name}},\n\nYour trial shift is confirmed for {{appointment_time}} at The Anchor.\n\nPlease bring proof of your right to work in the UK. You cannot perform duties without this check.\n\nBest,\nThe Anchor', true),
  ('reminder', 'Reminder - The Anchor', 'Hi {{first_name}},\n\nReminder: your {{appointment_type}} is tomorrow at {{appointment_time}} at The Anchor.\n\nBest,\nThe Anchor', true),
  ('manager_alert', 'Recruitment alert - {{alert_type}}', '{{alert_body}}', true)
ON CONFLICT DO NOTHING;

COMMIT;
