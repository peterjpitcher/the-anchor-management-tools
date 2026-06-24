BEGIN;

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
  UPDATE public.recruitment_applications
  SET booking_token_used_at = now(),
      updated_at = now()
  WHERE id = p_application_id
    AND candidate_id = p_candidate_id
    AND booking_token_hash = p_booking_token_hash
    AND booking_token_expires_at = p_token_expires_at
    AND booking_token_expires_at > now()
    AND booking_token_used_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking link is invalid, expired, or already used';
  END IF;

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

CREATE OR REPLACE FUNCTION public.recruitment_reschedule_appointment(
  p_appointment_id uuid,
  p_new_slot_id uuid,
  p_booking_token_hash text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_note text DEFAULT 'Appointment rescheduled',
  p_enforce_reschedule_limit boolean DEFAULT false
)
RETURNS public.recruitment_candidate_appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.recruitment_candidate_appointments;
  v_new_slot public.recruitment_appointment_slots;
  v_updated public.recruitment_candidate_appointments;
BEGIN
  SELECT *
  INTO v_appointment
  FROM public.recruitment_candidate_appointments
  WHERE id = p_appointment_id
    AND status = 'scheduled'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;

  IF p_booking_token_hash IS NOT NULL AND v_appointment.booking_token_hash IS DISTINCT FROM p_booking_token_hash THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;

  IF v_appointment.scheduled_start <= now() THEN
    RAISE EXCEPTION 'This appointment can no longer be changed online';
  END IF;

  IF p_enforce_reschedule_limit AND COALESCE(v_appointment.reschedule_count, 0) >= 1 THEN
    RAISE EXCEPTION 'This appointment has already been rescheduled once';
  END IF;

  UPDATE public.recruitment_appointment_slots
  SET status = 'booked',
      updated_at = now()
  WHERE id = p_new_slot_id
    AND status = 'open'
    AND archived_at IS NULL
    AND starts_at > now()
  RETURNING * INTO v_new_slot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot is no longer available';
  END IF;

  UPDATE public.recruitment_candidate_appointments
  SET slot_id = v_new_slot.id,
      scheduled_start = v_new_slot.starts_at,
      scheduled_end = v_new_slot.ends_at,
      timezone = v_new_slot.timezone,
      location = v_new_slot.location,
      supervisor_staff_id = v_new_slot.supervisor_staff_id,
      status = 'scheduled',
      calendar_sync_status = 'pending',
      calendar_last_error = NULL,
      reschedule_count = COALESCE(v_appointment.reschedule_count, 0) + 1,
      updated_at = now()
  WHERE id = v_appointment.id
  RETURNING * INTO v_updated;

  IF v_appointment.slot_id IS NOT NULL AND v_appointment.slot_id <> v_new_slot.id THEN
    UPDATE public.recruitment_appointment_slots
    SET status = 'open',
        updated_at = now()
    WHERE id = v_appointment.slot_id;
  END IF;

  INSERT INTO public.recruitment_application_status_events (
    application_id,
    from_status,
    to_status,
    changed_by,
    note,
    metadata
  )
  VALUES (
    v_appointment.application_id,
    NULL,
    CASE WHEN v_appointment.type = 'trial_shift' THEN 'trial_scheduled' ELSE 'interview_scheduled' END,
    p_actor_user_id,
    p_note,
    jsonb_build_object(
      'appointment_id', v_appointment.id,
      'old_slot_id', v_appointment.slot_id,
      'new_slot_id', v_new_slot.id
    )
  );

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recruitment_claim_appointment_slot(uuid, uuid, uuid, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recruitment_reschedule_appointment(uuid, uuid, text, uuid, text, boolean) TO authenticated, service_role;

COMMIT;
