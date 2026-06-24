BEGIN;

DROP FUNCTION IF EXISTS public.recruitment_reschedule_appointment(uuid, uuid, text, uuid, text, boolean);

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

GRANT EXECUTE ON FUNCTION public.recruitment_claim_appointment_slot(uuid, uuid, uuid, text, timestamptz) TO authenticated, service_role;

COMMIT;
