-- Add explicit permission and atomic update helper for existing holiday bookings.

INSERT INTO public.permissions (module_name, action, description)
VALUES ('leave', 'edit', 'Edit or delete existing leave requests')
ON CONFLICT (module_name, action) DO UPDATE
SET description = EXCLUDED.description;

WITH edit_permission AS (
  SELECT id
  FROM public.permissions
  WHERE module_name = 'leave'
    AND action = 'edit'
),
roles_to_grant AS (
  SELECT id AS role_id
  FROM public.roles
  WHERE name IN ('super_admin', 'manager')

  UNION

  SELECT DISTINCT rp.role_id
  FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE p.module_name = 'leave'
    AND p.action IN ('create', 'approve')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles_to_grant.role_id, edit_permission.id
FROM roles_to_grant
CROSS JOIN edit_permission
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.update_leave_request_dates(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_holiday_year smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_leave_date date;
  v_day_count integer := 0;
BEGIN
  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_range',
      'error', 'End date must be on or after start date'
    );
  END IF;

  SELECT *
  INTO v_request
  FROM public.leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'not_found',
      'error', 'Request not found'
    );
  END IF;

  IF v_request.status = 'declined' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'declined_request',
      'error', 'Declined holiday requests cannot be edited'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    WHERE lr.employee_id = v_request.employee_id
      AND lr.id <> p_request_id
      AND lr.status <> 'declined'
      AND lr.start_date <= p_end_date
      AND lr.end_date >= p_start_date
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'overlap',
      'error', 'Employee already has leave covering some of these dates'
    );
  END IF;

  UPDATE public.leave_requests
  SET
    start_date = p_start_date,
    end_date = p_end_date,
    holiday_year = p_holiday_year,
    updated_at = now()
  WHERE id = p_request_id;

  DELETE FROM public.leave_days
  WHERE request_id = p_request_id;

  FOR v_leave_date IN
    SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date
  LOOP
    INSERT INTO public.leave_days (request_id, employee_id, leave_date)
    VALUES (p_request_id, v_request.employee_id, v_leave_date);

    v_day_count := v_day_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', v_request.employee_id,
    'days', v_day_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'overlap',
      'error', 'Employee already has leave covering some of these dates'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_leave_request_dates(uuid, date, date, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_leave_request_dates(uuid, date, date, smallint) FROM anon;
REVOKE ALL ON FUNCTION public.update_leave_request_dates(uuid, date, date, smallint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_leave_request_dates(uuid, date, date, smallint) TO service_role;
