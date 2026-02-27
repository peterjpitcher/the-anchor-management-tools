-- Add job_title parameter to create_employee_invite RPC

CREATE OR REPLACE FUNCTION create_employee_invite(p_email TEXT, p_job_title TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID;
  v_token TEXT;
BEGIN
  -- Check email uniqueness
  IF EXISTS (SELECT 1 FROM employees e WHERE e.email_address = p_email) THEN
    RAISE EXCEPTION 'An employee with this email address already exists';
  END IF;

  -- Insert employee with Onboarding status
  INSERT INTO employees (
    email_address,
    job_title,
    status,
    invited_at,
    created_at,
    updated_at
  ) VALUES (
    p_email,
    p_job_title,
    'Onboarding',
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING employees.employee_id INTO v_employee_id;

  -- Insert invite token
  INSERT INTO employee_invite_tokens (employee_id, email)
  VALUES (v_employee_id, p_email)
  RETURNING employee_invite_tokens.token INTO v_token;

  -- Insert empty onboarding checklist row
  INSERT INTO employee_onboarding_checklist (employee_id, created_at, updated_at)
  VALUES (v_employee_id, NOW(), NOW())
  ON CONFLICT (employee_id) DO NOTHING;

  RETURN jsonb_build_object('employee_id', v_employee_id, 'token', v_token);
END;
$$;
