-- Right to work notice acknowledgement.
--
-- The check itself is done in person by a manager who sees the original documents, or online
-- using the applicant's share code. This is deliberately NOT a self certification step: an
-- employee ticking a box is not a right to work check and must never be treated as one.
--
-- What is recorded here is that we TOLD the new starter they cannot be given shifts until the
-- check is done, and when we told them. That is a useful record to have, and it is the only
-- part of the process the employee can complete on their own.
--
-- No new table: this reuses employee_onboarding_responses, which already exists for answers
-- that produce no other data.

create or replace function public.complete_employee_onboarding(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_token employee_invite_tokens%ROWTYPE;
  v_employee employees%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_token FROM employee_invite_tokens WHERE token = p_token FOR UPDATE;

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

  SELECT * INTO v_employee FROM employees WHERE employee_id = v_token.employee_id FOR UPDATE;

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

  IF NOT EXISTS (
    SELECT 1 FROM employee_onboarding_responses r
    WHERE r.employee_id = v_employee.employee_id
      AND r.question = 'booked_time_off'
  ) THEN
    RAISE EXCEPTION 'Tell us about any time off you have already booked before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_onboarding_responses r
    WHERE r.employee_id = v_employee.employee_id
      AND r.question = 'right_to_work_notice'
      AND r.answer = 'acknowledged'
  ) THEN
    RAISE EXCEPTION 'Please confirm you have read what to bring for your right to work check.';
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
$function$;

-- Records an onboarding answer that produces no other data. Used by the right to work notice.
create or replace function public.record_onboarding_acknowledgement(
  p_token    text,
  p_question text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_token    employee_invite_tokens%rowtype;
  v_employee employees%rowtype;
  v_now      timestamptz := now();
begin
  if p_question not in ('right_to_work_notice') then
    raise exception 'UNSUPPORTED_QUESTION';
  end if;

  select * into v_token from employee_invite_tokens where token = p_token for update;
  if not found or v_token.invite_type <> 'onboarding' then
    raise exception 'TOKEN_INVALID';
  end if;
  if v_token.completed_at is not null or v_token.expires_at <= v_now then
    raise exception 'TOKEN_EXPIRED';
  end if;

  select * into v_employee from employees where employee_id = v_token.employee_id;
  if not found then
    raise exception 'TOKEN_INVALID';
  end if;

  insert into employee_onboarding_responses (employee_id, question, answer, answered_at, submission_version)
  values (v_employee.employee_id, p_question, 'acknowledged', v_now, 1)
  on conflict (employee_id, question) do update
    set answer = 'acknowledged', answered_at = excluded.answered_at;

  return jsonb_build_object('employee_id', v_employee.employee_id, 'question', p_question);
end;
$function$;

revoke all on function public.record_onboarding_acknowledgement(text, text) from public;
grant execute on function public.record_onboarding_acknowledgement(text, text) to service_role;

comment on function public.record_onboarding_acknowledgement is
  'Stores an onboarding acknowledgement. This is a record that we told the starter something, never evidence of a check.';
