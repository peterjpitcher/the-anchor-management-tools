-- Atomic staff-side appointment scheduling.
--
-- The previous staff scheduling path (scheduleRecruitmentAppointmentByStaff) did
-- three independent committed writes — a status transition to interview_invited,
-- a booking-token write, then the atomic claim RPC — with no rollback. A claim
-- failure left the application stranded as interview_invited with a live unused
-- token and a misleading status event.
--
-- This function folds everything into ONE transaction, mirroring
-- recruitment_claim_appointment_slot but: (a) it is staff-authoritative (it does
-- not require a pre-existing valid candidate token — it writes the token it is
-- given and burns it), (b) it transitions straight to the scheduled state with
-- force=true so scheduling works from new/ai_screened/on_hold, and (c) it enforces
-- the duplicate guard PER APPLICATION (one future scheduled appointment of the
-- given type) under the application row lock, so concurrent staff scheduling is
-- race-safe. Burning the token also prevents a candidate self-booking a second
-- slot via the public link after a manager has scheduled.
--
-- A partial unique index on (application_id, type) WHERE status='scheduled' was
-- deliberately NOT added: past appointments are never auto-moved off 'scheduled'
-- (no cron does this), so such an index would wrongly block re-scheduling after a
-- past, unrecorded appointment. The future-only check below + the row lock is the
-- correct guard.

CREATE OR REPLACE FUNCTION public.recruitment_staff_schedule_appointment(
  p_slot_id uuid,
  p_application_id uuid,
  p_booking_token_hash text,
  p_token_expires_at timestamptz,
  p_actor_user_id uuid,
  p_appointment_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_application public.recruitment_applications;
  v_slot public.recruitment_appointment_slots;
  v_appointment_id uuid;
  v_label text;
BEGIN
  -- Lock the application row for the duration of the transaction so concurrent
  -- staff schedules for the same application serialise on the duplicate check.
  SELECT *
  INTO v_application
  FROM public.recruitment_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF v_application.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived applications cannot be scheduled';
  END IF;
  IF v_application.status IN ('rejected', 'withdrawn', 'declined_duplicate', 'hired') THEN
    RAISE EXCEPTION 'Closed applications cannot be scheduled';
  END IF;

  -- Compare-and-set the slot open -> booked (race-safe against any other claim).
  UPDATE public.recruitment_appointment_slots
  SET status = 'booked',
      updated_at = now()
  WHERE id = p_slot_id
    AND status = 'open'
    AND archived_at IS NULL
    AND starts_at > now()
    AND (p_appointment_type IS NULL OR type = p_appointment_type)
  RETURNING * INTO v_slot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot is no longer available';
  END IF;

  v_label := CASE WHEN v_slot.type = 'trial_shift' THEN 'trial shift' ELSE 'interview' END;

  -- Per-application duplicate guard (future scheduled appointment of same type).
  IF EXISTS (
    SELECT 1
    FROM public.recruitment_candidate_appointments
    WHERE application_id = p_application_id
      AND type = v_slot.type
      AND status = 'scheduled'
      AND scheduled_start > now()
  ) THEN
    RAISE EXCEPTION 'This application already has a scheduled %', v_label;
  END IF;

  -- Record the booking token on the application and mark it consumed, so the
  -- public booking link cannot be used to self-book another slot afterwards.
  UPDATE public.recruitment_applications
  SET booking_token_hash = p_booking_token_hash,
      booking_token_type = v_slot.type,
      booking_token_expires_at = p_token_expires_at,
      booking_token_used_at = now(),
      updated_at = now()
  WHERE id = p_application_id;

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
    v_application.candidate_id,
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

  -- Force the transition so scheduling works from new/ai_screened/on_hold etc.
  PERFORM public.recruitment_transition_application_status_actor(
    p_application_id,
    CASE WHEN v_slot.type = 'trial_shift' THEN 'trial_scheduled' ELSE 'interview_scheduled' END,
    'Manager scheduled ' || v_label,
    jsonb_build_object('slot_id', p_slot_id, 'appointment_id', v_appointment_id, 'staff_scheduled', true),
    p_actor_user_id,
    true
  );

  RETURN v_appointment_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recruitment_staff_schedule_appointment(uuid, uuid, text, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recruitment_staff_schedule_appointment(uuid, uuid, text, timestamptz, uuid, text) TO service_role;
