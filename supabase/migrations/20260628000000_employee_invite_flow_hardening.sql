-- Harden employee invite tokens by separating new-hire onboarding from
-- existing-employee portal access and moving final onboarding completion into
-- database transactions.

ALTER TABLE employee_invite_tokens
  ADD COLUMN IF NOT EXISTS invite_type TEXT NOT NULL DEFAULT 'onboarding';

UPDATE employee_invite_tokens
SET invite_type = 'onboarding'
WHERE invite_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'employee_invite_tokens'
      AND constraint_name = 'employee_invite_tokens_invite_type_check'
  ) THEN
    ALTER TABLE employee_invite_tokens
      ADD CONSTRAINT employee_invite_tokens_invite_type_check
      CHECK (invite_type IN ('onboarding', 'portal_access'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_invite_tokens_pending_type
  ON employee_invite_tokens (employee_id, invite_type, created_at DESC)
  WHERE completed_at IS NULL;

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
  IF EXISTS (SELECT 1 FROM employees e WHERE lower(e.email_address) = lower(p_email)) THEN
    RAISE EXCEPTION 'An employee with this email address already exists';
  END IF;

  INSERT INTO employees (
    email_address,
    job_title,
    status,
    invited_at,
    created_at,
    updated_at
  ) VALUES (
    lower(p_email),
    p_job_title,
    'Onboarding',
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING employees.employee_id INTO v_employee_id;

  INSERT INTO employee_invite_tokens (employee_id, email, invite_type)
  VALUES (v_employee_id, lower(p_email), 'onboarding')
  RETURNING employee_invite_tokens.token INTO v_token;

  INSERT INTO employee_onboarding_checklist (employee_id, created_at, updated_at)
  VALUES (v_employee_id, NOW(), NOW())
  ON CONFLICT (employee_id) DO NOTHING;

  RETURN jsonb_build_object('employee_id', v_employee_id, 'token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION link_employee_invite_account(p_token TEXT, p_auth_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token employee_invite_tokens%ROWTYPE;
  v_employee employees%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_token
  FROM employee_invite_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite link.';
  END IF;

  IF v_token.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite link has already been used.';
  END IF;

  IF v_token.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invite link has expired.';
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = v_token.employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.';
  END IF;

  IF lower(v_token.email) <> lower(v_employee.email_address) THEN
    RAISE EXCEPTION 'Invite link no longer matches the employee email address.';
  END IF;

  IF v_employee.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Account already created. Please sign in.';
  END IF;

  IF v_token.invite_type = 'onboarding' THEN
    IF v_employee.status <> 'Onboarding' THEN
      RAISE EXCEPTION 'This onboarding invite is no longer valid.';
    END IF;

    UPDATE employees
    SET auth_user_id = p_auth_user_id,
        updated_at = v_now
    WHERE employee_id = v_employee.employee_id;

  ELSIF v_token.invite_type = 'portal_access' THEN
    IF v_employee.status NOT IN ('Active', 'Started Separation') THEN
      RAISE EXCEPTION 'Portal invites can only be used by active employees.';
    END IF;

    UPDATE employees
    SET auth_user_id = p_auth_user_id,
        updated_at = v_now
    WHERE employee_id = v_employee.employee_id;

    UPDATE employee_invite_tokens
    SET completed_at = v_now
    WHERE id = v_token.id;

    UPDATE employee_invite_tokens
    SET expires_at = v_now
    WHERE employee_id = v_employee.employee_id
      AND invite_type = 'portal_access'
      AND completed_at IS NULL
      AND id <> v_token.id
      AND expires_at > v_now;

  ELSE
    RAISE EXCEPTION 'Unsupported invite type.';
  END IF;

  RETURN jsonb_build_object(
    'employee_id', v_employee.employee_id,
    'email', v_employee.email_address,
    'invite_type', v_token.invite_type,
    'auth_user_id', p_auth_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_employee_onboarding(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token employee_invite_tokens%ROWTYPE;
  v_employee employees%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_token
  FROM employee_invite_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite link.';
  END IF;

  IF v_token.invite_type <> 'onboarding' THEN
    RAISE EXCEPTION 'This link is not for employee onboarding.';
  END IF;

  IF v_token.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite link has already been used.';
  END IF;

  IF v_token.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invite link has expired.';
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = v_token.employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.';
  END IF;

  IF lower(v_token.email) <> lower(v_employee.email_address) THEN
    RAISE EXCEPTION 'Invite link no longer matches the employee email address.';
  END IF;

  IF v_employee.status <> 'Onboarding' THEN
    RAISE EXCEPTION 'This onboarding invite is no longer valid.';
  END IF;

  IF v_employee.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Create your account before completing onboarding.';
  END IF;

  IF coalesce(trim(v_employee.first_name), '') = '' OR coalesce(trim(v_employee.last_name), '') = '' THEN
    RAISE EXCEPTION 'Personal details must be completed before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM employee_emergency_contacts c
    WHERE c.employee_id = v_employee.employee_id
      AND coalesce(trim(c.name), '') <> ''
      AND lower(coalesce(c.priority, 'primary')) = 'primary'
  ) THEN
    RAISE EXCEPTION 'Primary emergency contact must be completed before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_financial_details f
    WHERE f.employee_id = v_employee.employee_id
  ) THEN
    RAISE EXCEPTION 'Financial details must be saved before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_health_records h
    WHERE h.employee_id = v_employee.employee_id
  ) THEN
    RAISE EXCEPTION 'Health information must be saved before submitting.';
  END IF;

  UPDATE employees
  SET status = 'Active',
      onboarding_completed_at = v_now,
      updated_at = v_now
  WHERE employee_id = v_employee.employee_id
  RETURNING * INTO v_employee;

  UPDATE employee_invite_tokens
  SET completed_at = v_now
  WHERE id = v_token.id;

  UPDATE employee_invite_tokens
  SET expires_at = v_now
  WHERE employee_id = v_employee.employee_id
    AND invite_type = 'onboarding'
    AND completed_at IS NULL
    AND id <> v_token.id
    AND expires_at > v_now;

  RETURN jsonb_build_object(
    'employee_id', v_employee.employee_id,
    'email', v_employee.email_address,
    'first_name', v_employee.first_name,
    'last_name', v_employee.last_name,
    'auth_user_id', v_employee.auth_user_id,
    'onboarding_completed_at', v_employee.onboarding_completed_at
  );
END;
$$;
