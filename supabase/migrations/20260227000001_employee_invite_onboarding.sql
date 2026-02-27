-- Employee Invite & Self-Service Onboarding Migration
-- Phase 1a: Status constraint update

UPDATE employees SET status = 'Onboarding' WHERE status = 'Prospective';

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('Onboarding', 'Active', 'Started Separation', 'Former'));

-- Phase 1b: Relax NOT NULL for invite-created records

ALTER TABLE employees ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE employees ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE employees ALTER COLUMN job_title DROP NOT NULL;
ALTER TABLE employees ALTER COLUMN employment_start_date DROP NOT NULL;

-- Enforce required fields for non-Onboarding employees
ALTER TABLE employees ADD CONSTRAINT chk_employee_active_fields
  CHECK (
    status = 'Onboarding' OR (
      first_name IS NOT NULL AND first_name != '' AND
      last_name IS NOT NULL AND last_name != '' AND
      job_title IS NOT NULL AND
      employment_start_date IS NOT NULL
    )
  );

-- Update name length constraint to handle NULLs
ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_name_length;
ALTER TABLE employees ADD CONSTRAINT chk_employee_name_length
  CHECK (
    (first_name IS NULL OR length(first_name) <= 100) AND
    (last_name IS NULL OR length(last_name) <= 100) AND
    (job_title IS NULL OR length(job_title) <= 100)
  );

-- Phase 1c: New columns on employees

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_auth_user_id
  ON employees(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- Phase 1d: New employee_invite_tokens table

CREATE TABLE IF NOT EXISTS employee_invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  completed_at TIMESTAMPTZ,
  day3_chase_sent_at TIMESTAMPTZ,
  day6_chase_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON employee_invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_employee ON employee_invite_tokens(employee_id);

ALTER TABLE employee_invite_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON employee_invite_tokens;
CREATE POLICY "Service role full access" ON employee_invite_tokens
  TO service_role USING (true) WITH CHECK (true);

-- Phase 1e: create_employee_invite RPC
-- Atomically: check email uniqueness -> insert employee (Onboarding) -> insert invite token
-- -> insert empty onboarding_checklists row -> return employee_id + token

CREATE OR REPLACE FUNCTION create_employee_invite(p_email TEXT)
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
    status,
    invited_at,
    created_at,
    updated_at
  ) VALUES (
    p_email,
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
