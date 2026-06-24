CREATE OR REPLACE FUNCTION public.approve_rota_open_shift_request(
  p_request_id uuid,
  p_shift_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_expected_shift_date date,
  p_expected_start_time time,
  p_expected_end_time time,
  p_expected_unpaid_break_minutes smallint,
  p_expected_department text,
  p_expected_is_overnight boolean,
  p_expected_name text
)
RETURNS TABLE (
  status text,
  shift_id uuid,
  week_start date,
  reason text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_request public.rota_open_shift_requests%ROWTYPE;
  v_shift public.rota_shifts%ROWTYPE;
  v_published public.rota_published_shifts%ROWTYPE;
  v_week_start date;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO v_request
  FROM public.rota_open_shift_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, NULL::date, 'request_missing'::text;
    RETURN;
  END IF;

  SELECT rw.week_start
  INTO v_week_start
  FROM public.rota_weeks rw
  JOIN public.rota_shifts rs ON rs.week_id = rw.id
  WHERE rs.id = p_shift_id;

  IF v_request.shift_id IS DISTINCT FROM p_shift_id
    OR v_request.employee_id IS DISTINCT FROM p_employee_id
    OR v_request.status IS DISTINCT FROM 'pending' THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'request_changed'::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_shift
  FROM public.rota_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'shift_missing'::text;
    RETURN;
  END IF;

  IF v_shift.employee_id IS NOT NULL
    OR v_shift.is_open_shift IS DISTINCT FROM true
    OR v_shift.status IS DISTINCT FROM 'scheduled'
    OR v_shift.shift_date IS DISTINCT FROM p_expected_shift_date
    OR v_shift.start_time IS DISTINCT FROM p_expected_start_time
    OR v_shift.end_time IS DISTINCT FROM p_expected_end_time
    OR v_shift.unpaid_break_minutes IS DISTINCT FROM p_expected_unpaid_break_minutes
    OR v_shift.department IS DISTINCT FROM p_expected_department
    OR v_shift.is_overnight IS DISTINCT FROM p_expected_is_overnight
    OR v_shift.name IS DISTINCT FROM p_expected_name THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'live_shift_changed'::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_published
  FROM public.rota_published_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'published_shift_missing'::text;
    RETURN;
  END IF;

  IF v_published.employee_id IS NOT NULL
    OR v_published.is_open_shift IS DISTINCT FROM true
    OR v_published.status IS DISTINCT FROM 'scheduled'
    OR v_published.shift_date IS DISTINCT FROM p_expected_shift_date
    OR v_published.start_time IS DISTINCT FROM p_expected_start_time
    OR v_published.end_time IS DISTINCT FROM p_expected_end_time
    OR v_published.unpaid_break_minutes IS DISTINCT FROM p_expected_unpaid_break_minutes
    OR v_published.department IS DISTINCT FROM p_expected_department
    OR v_published.is_overnight IS DISTINCT FROM p_expected_is_overnight
    OR v_published.name IS DISTINCT FROM p_expected_name THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'published_shift_changed'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.employee_id = p_employee_id
      AND e.status IN ('Active', 'Started Separation')
  ) THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'employee_not_active'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rota_shifts rs
    WHERE rs.id <> p_shift_id
      AND rs.employee_id = p_employee_id
      AND rs.is_open_shift = false
      AND rs.status = 'scheduled'
      AND tsrange(
        rs.shift_date + rs.start_time,
        rs.shift_date + rs.end_time + CASE
          WHEN rs.is_overnight OR rs.end_time <= rs.start_time THEN interval '1 day'
          ELSE interval '0 day'
        END,
        '[)'
      ) && tsrange(
        p_expected_shift_date + p_expected_start_time,
        p_expected_shift_date + p_expected_end_time + CASE
          WHEN p_expected_is_overnight OR p_expected_end_time <= p_expected_start_time THEN interval '1 day'
          ELSE interval '0 day'
        END,
        '[)'
      )
  ) THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'employee_shift_overlap'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rota_shifts rs
    WHERE rs.id <> p_shift_id
      AND rs.employee_id = p_employee_id
      AND rs.status = 'sick'
      AND rs.shift_date IN (
        p_expected_shift_date,
        CASE
          WHEN p_expected_is_overnight OR p_expected_end_time <= p_expected_start_time
            THEN p_expected_shift_date + 1
          ELSE p_expected_shift_date
        END
      )
  ) THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'employee_sick_marker'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.leave_days ld
    JOIN public.leave_requests lr ON lr.id = ld.request_id
    WHERE ld.employee_id = p_employee_id
      AND lr.status = 'approved'
      AND ld.leave_date IN (
        p_expected_shift_date,
        CASE
          WHEN p_expected_is_overnight OR p_expected_end_time <= p_expected_start_time
            THEN p_expected_shift_date + 1
          ELSE p_expected_shift_date
        END
      )
  ) THEN
    RETURN QUERY SELECT 'stale'::text, p_shift_id, v_week_start, 'employee_on_leave'::text;
    RETURN;
  END IF;

  UPDATE public.rota_shifts
  SET
    employee_id = p_employee_id,
    is_open_shift = false,
    acceptance_status = 'accepted',
    acceptance_decided_at = v_now,
    acceptance_decided_by = p_employee_id,
    acceptance_note = NULL,
    auto_accept_reason = NULL,
    auto_accept_warning_sent_at = NULL,
    reassigned_at = v_now,
    reassigned_by = p_actor_user_id,
    reassignment_reason = 'Open shift request approved',
    updated_at = v_now
  WHERE id = p_shift_id;

  UPDATE public.rota_published_shifts
  SET
    employee_id = p_employee_id,
    is_open_shift = false,
    acceptance_status = 'accepted',
    acceptance_decided_at = v_now,
    acceptance_decided_by = p_employee_id,
    acceptance_note = NULL,
    auto_accept_reason = NULL,
    auto_accept_warning_sent_at = NULL,
    published_at = v_now
  WHERE id = p_shift_id;

  UPDATE public.rota_open_shift_requests
  SET
    status = 'approved',
    decided_at = v_now,
    decided_by = p_actor_user_id,
    manager_note = 'Approved from manager email',
    updated_at = v_now
  WHERE id = p_request_id;

  UPDATE public.rota_open_shift_requests
  SET
    status = 'declined',
    decided_at = v_now,
    decided_by = p_actor_user_id,
    manager_note = 'Another request was approved for this shift',
    updated_at = v_now
  WHERE shift_id = p_shift_id
    AND id <> p_request_id
    AND status = 'pending';

  RETURN QUERY SELECT 'approved'::text, p_shift_id, v_week_start, NULL::text;
END;
$$;
