BEGIN;

ALTER TABLE public.recruitment_applications
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id);

ALTER TABLE public.recruitment_appointment_slots
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id);

ALTER TABLE public.recruitment_candidate_appointments
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_recruitment_applications_active
  ON public.recruitment_applications (created_at DESC)
  WHERE archived_at IS NULL AND duplicate_of_application_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_recruitment_appointment_slots_active
  ON public.recruitment_appointment_slots (starts_at)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recruitment_candidate_appointments_active
  ON public.recruitment_candidate_appointments (scheduled_start DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.recruitment_interview_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.recruitment_candidate_appointments(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.recruitment_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_rating integer CHECK (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5),
  recommendation text NOT NULL DEFAULT 'no_decision' CHECK (recommendation IN ('hire', 'hold', 'reject', 'rebook', 'no_decision')),
  comments text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_scorecards_appointment
  ON public.recruitment_interview_scorecards (appointment_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_recruitment_scorecards_updated_at ON public.recruitment_interview_scorecards;
CREATE TRIGGER trg_recruitment_scorecards_updated_at
  BEFORE UPDATE ON public.recruitment_interview_scorecards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.recruitment_interview_scorecards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recruitment read access" ON public.recruitment_interview_scorecards;
CREATE POLICY "Recruitment read access"
  ON public.recruitment_interview_scorecards
  FOR SELECT
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'recruitment', 'view'));

DROP POLICY IF EXISTS "Recruitment create access" ON public.recruitment_interview_scorecards;
CREATE POLICY "Recruitment create access"
  ON public.recruitment_interview_scorecards
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'recruitment', 'create') OR public.user_has_permission(auth.uid(), 'recruitment', 'edit'));

DROP POLICY IF EXISTS "Recruitment edit access" ON public.recruitment_interview_scorecards;
CREATE POLICY "Recruitment edit access"
  ON public.recruitment_interview_scorecards
  FOR UPDATE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'recruitment', 'edit') OR public.user_has_permission(auth.uid(), 'recruitment', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'recruitment', 'edit') OR public.user_has_permission(auth.uid(), 'recruitment', 'manage'));

DROP POLICY IF EXISTS "Recruitment delete access" ON public.recruitment_interview_scorecards;
CREATE POLICY "Recruitment delete access"
  ON public.recruitment_interview_scorecards
  FOR DELETE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'recruitment', 'delete'));

DROP POLICY IF EXISTS "Service role manages recruitment" ON public.recruitment_interview_scorecards;
CREATE POLICY "Service role manages recruitment"
  ON public.recruitment_interview_scorecards
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.recruitment_application_transition_allowed(
  p_from_status text,
  p_to_status text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_from_status = p_to_status THEN
    RETURN true;
  END IF;

  RETURN CASE p_from_status
    WHEN 'new' THEN p_to_status = ANY(ARRAY['ai_screened','shortlisted','interview_invited','trial_offered','rejected','withdrawn','on_hold','talent_pool','declined_duplicate'])
    WHEN 'ai_screened' THEN p_to_status = ANY(ARRAY['shortlisted','interview_invited','trial_offered','offered','rejected','withdrawn','on_hold','talent_pool','declined_duplicate'])
    WHEN 'shortlisted' THEN p_to_status = ANY(ARRAY['interview_invited','interview_scheduled','trial_offered','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'interview_invited' THEN p_to_status = ANY(ARRAY['interview_scheduled','interviewed','trial_offered','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'interview_scheduled' THEN p_to_status = ANY(ARRAY['interviewed','trial_offered','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'interviewed' THEN p_to_status = ANY(ARRAY['trial_offered','trial_scheduled','offered','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'trial_offered' THEN p_to_status = ANY(ARRAY['trial_scheduled','trial_completed','offered','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'trial_scheduled' THEN p_to_status = ANY(ARRAY['trial_completed','offered','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'trial_completed' THEN p_to_status = ANY(ARRAY['offered','hired','rejected','withdrawn','on_hold','talent_pool'])
    WHEN 'offered' THEN p_to_status = ANY(ARRAY['hired','rejected','withdrawn','on_hold'])
    WHEN 'on_hold' THEN p_to_status = ANY(ARRAY['ai_screened','shortlisted','interview_invited','interview_scheduled','trial_offered','trial_scheduled','offered','rejected','withdrawn','talent_pool'])
    WHEN 'talent_pool' THEN p_to_status = ANY(ARRAY['new','ai_screened','shortlisted','interview_invited','trial_offered','rejected','withdrawn','on_hold'])
    ELSE false
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.recruitment_transition_application_status_actor(
  p_application_id uuid,
  p_to_status text,
  p_note text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_actor_user_id uuid DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS public.recruitment_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.recruitment_applications;
  v_from_status text;
BEGIN
  IF p_actor_user_id IS NOT NULL
     AND NOT public.user_has_permission(p_actor_user_id, 'recruitment', 'edit')
     AND NOT public.user_has_permission(p_actor_user_id, 'recruitment', 'manage') THEN
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

  IF NOT p_force AND NOT public.recruitment_application_transition_allowed(v_from_status, p_to_status) THEN
    RAISE EXCEPTION 'Illegal recruitment status transition from % to %', v_from_status, p_to_status;
  END IF;

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
    p_actor_user_id,
    p_note,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('forced', p_force)
  );

  RETURN v_application;
END;
$$;

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
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NOT NULL
     AND NOT public.user_has_permission(v_user_id, 'recruitment', 'edit')
     AND NOT public.user_has_permission(v_user_id, 'recruitment', 'manage') THEN
    RAISE EXCEPTION 'Insufficient recruitment permissions';
  END IF;

  RETURN public.recruitment_transition_application_status_actor(
    p_application_id,
    p_to_status,
    p_note,
    p_metadata,
    v_user_id,
    false
  );
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
    AND archived_at IS NULL
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

  PERFORM public.recruitment_transition_application_status_actor(
    p_application_id,
    CASE WHEN v_slot.type = 'trial_shift' THEN 'trial_scheduled' ELSE 'interview_scheduled' END,
    'Candidate booked appointment',
    jsonb_build_object('slot_id', p_slot_id, 'appointment_id', v_appointment_id),
    NULL,
    false
  );

  RETURN v_appointment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recruitment_application_transition_allowed(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recruitment_transition_application_status_actor(uuid, text, text, jsonb, uuid, boolean) TO authenticated, service_role;

COMMIT;
