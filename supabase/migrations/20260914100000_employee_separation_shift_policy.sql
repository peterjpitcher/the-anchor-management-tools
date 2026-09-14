-- Keep an employee's separation decision, current rota and published rota in one transaction.
-- The application calls this only with the service role after checking employees.edit.

ALTER TABLE public.employees
  ADD COLUMN separation_shift_policy text,
  ADD COLUMN separation_started_at timestamptz;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_separation_shift_policy_check
  CHECK (
    (separation_shift_policy IS NULL AND separation_started_at IS NULL)
    OR (
      status = 'Started Separation'
      AND separation_shift_policy IN ('work_remaining', 'release_remaining')
      AND separation_started_at IS NOT NULL
    )
  );

COMMENT ON COLUMN public.employees.separation_shift_policy IS
  'Whether a separating employee keeps agreed remaining shifts or releases every not-yet-started shift.';
COMMENT ON COLUMN public.employees.separation_started_at IS
  'The instant the current formal separation was started.';

CREATE OR REPLACE FUNCTION public.begin_employee_separation(
  p_employee_id uuid,
  p_employment_end_date date,
  p_shift_policy text,
  p_actor_user_id uuid,
  p_started_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_now timestamptz := COALESCE(p_started_at, now());
  v_retained_shifts jsonb := '[]'::jsonb;
  v_released_shifts jsonb := '[]'::jsonb;
  v_affected_published_week_ids jsonb := '[]'::jsonb;
BEGIN
  SELECT *
  INTO v_employee
  FROM public.employees
  WHERE employee_id = p_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  IF v_employee.status <> 'Active' THEN
    RETURN jsonb_build_object('state', 'status_conflict', 'status', v_employee.status);
  END IF;

  IF p_employment_end_date IS NULL THEN
    RETURN jsonb_build_object('state', 'invalid_end_date', 'reason', 'required');
  END IF;

  IF v_employee.employment_start_date IS NOT NULL
     AND p_employment_end_date <= v_employee.employment_start_date THEN
    RETURN jsonb_build_object(
      'state', 'invalid_end_date',
      'reason', 'not_after_start_date',
      'employment_start_date', v_employee.employment_start_date
    );
  END IF;

  IF p_shift_policy NOT IN ('work_remaining', 'release_remaining') THEN
    RETURN jsonb_build_object('state', 'invalid_shift_policy');
  END IF;

  -- Lock every still-assigned future shift before calculating the retained and released sets.
  PERFORM 1
  FROM public.rota_shifts s
  WHERE s.employee_id = p_employee_id
    AND s.status = 'scheduled'
    AND s.is_open_shift = false
    AND ((s.shift_date + s.start_time) AT TIME ZONE 'Europe/London') > v_now
  FOR UPDATE;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'week_id', s.week_id,
      'shift_date', s.shift_date,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'department', s.department,
      'name', s.name,
      'acceptance_status', s.acceptance_status,
      'week_status', w.status
    ) ORDER BY s.shift_date, s.start_time, s.id
  ), '[]'::jsonb)
  INTO v_retained_shifts
  FROM public.rota_shifts s
  JOIN public.rota_weeks w ON w.id = s.week_id
  WHERE s.employee_id = p_employee_id
    AND s.status = 'scheduled'
    AND s.is_open_shift = false
    AND ((s.shift_date + s.start_time) AT TIME ZONE 'Europe/London') > v_now
    AND p_shift_policy = 'work_remaining'
    AND s.shift_date <= p_employment_end_date;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'week_id', s.week_id,
      'shift_date', s.shift_date,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'department', s.department,
      'name', s.name,
      'acceptance_status', s.acceptance_status,
      'week_status', w.status
    ) ORDER BY s.shift_date, s.start_time, s.id
  ), '[]'::jsonb)
  INTO v_released_shifts
  FROM public.rota_shifts s
  JOIN public.rota_weeks w ON w.id = s.week_id
  WHERE s.employee_id = p_employee_id
    AND s.status = 'scheduled'
    AND s.is_open_shift = false
    AND ((s.shift_date + s.start_time) AT TIME ZONE 'Europe/London') > v_now
    AND (
      p_shift_policy = 'release_remaining'
      OR s.shift_date > p_employment_end_date
    );

  SELECT COALESCE(jsonb_agg(week_id ORDER BY week_id), '[]'::jsonb)
  INTO v_affected_published_week_ids
  FROM (
    SELECT DISTINCT ps.week_id
    FROM public.rota_published_shifts ps
    WHERE ps.employee_id = p_employee_id
      AND ps.id IN (
        SELECT (value->>'id')::uuid
        FROM jsonb_array_elements(v_released_shifts)
      )
  ) affected;

  INSERT INTO public.rota_shift_calendar_cancellations (
    shift_id,
    employee_id,
    week_id,
    shift_date,
    start_time,
    end_time,
    unpaid_break_minutes,
    department,
    notes,
    is_overnight,
    name,
    cancelled_at,
    reason
  )
  SELECT
    s.id,
    p_employee_id,
    s.week_id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes,
    s.department,
    s.notes,
    s.is_overnight,
    s.name,
    v_now,
    'Released during employee separation'
  FROM public.rota_shifts s
  WHERE s.employee_id = p_employee_id
    AND s.id IN (
      SELECT (value->>'id')::uuid
      FROM jsonb_array_elements(v_released_shifts)
    )
    AND EXISTS (
      SELECT 1
      FROM public.rota_published_shifts ps
      WHERE ps.id = s.id
        AND ps.employee_id = p_employee_id
    )
  ON CONFLICT (shift_id, employee_id) DO UPDATE
  SET cancelled_at = EXCLUDED.cancelled_at,
      reason = EXCLUDED.reason;

  UPDATE public.rota_shift_templates
  SET employee_id = NULL,
      updated_at = v_now
  WHERE employee_id = p_employee_id;

  UPDATE public.rota_published_shifts
  SET employee_id = NULL,
      is_open_shift = true,
      acceptance_status = NULL,
      acceptance_decided_at = NULL,
      acceptance_decided_by = NULL,
      acceptance_note = NULL,
      auto_accept_reason = NULL,
      auto_accept_warning_sent_at = NULL,
      published_at = v_now
  WHERE employee_id = p_employee_id
    AND id IN (
      SELECT (value->>'id')::uuid
      FROM jsonb_array_elements(v_released_shifts)
    );

  UPDATE public.rota_shifts
  SET original_employee_id = COALESCE(original_employee_id, employee_id),
      reassigned_from_id = employee_id,
      employee_id = NULL,
      is_open_shift = true,
      acceptance_status = NULL,
      acceptance_decided_at = NULL,
      acceptance_decided_by = NULL,
      acceptance_note = NULL,
      auto_accept_reason = NULL,
      auto_accept_warning_sent_at = NULL,
      reassigned_at = v_now,
      reassigned_by = p_actor_user_id,
      reassignment_reason = 'Released during employee separation',
      updated_at = v_now
  WHERE employee_id = p_employee_id
    AND id IN (
      SELECT (value->>'id')::uuid
      FROM jsonb_array_elements(v_released_shifts)
    );

  UPDATE public.employees
  SET status = 'Started Separation',
      employment_end_date = p_employment_end_date,
      separation_shift_policy = p_shift_policy,
      separation_started_at = v_now,
      updated_at = v_now
  WHERE employee_id = p_employee_id;

  RETURN jsonb_build_object(
    'state', 'started',
    'retained_shifts', v_retained_shifts,
    'released_shifts', v_released_shifts,
    'affected_published_week_ids', v_affected_published_week_ids
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_employee_separation(uuid, date, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_employee_separation(uuid, date, text, uuid, timestamptz)
  TO service_role;

