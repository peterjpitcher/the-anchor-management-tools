-- Onboarding data completeness.
--
-- Two gaps, both of which leave a live employee record missing rows the rest of the app expects.
--
-- 1. create_employee_transaction inserts only employees, employee_financial_details and
--    employee_health_records. The invite path creates an onboarding checklist row; the manual
--    "Add employee" path never has. Five current active employees therefore have no checklist
--    row, and two have no pay settings row, which silently means "25 day allowance".
-- 2. Those rows are backfilled here for everyone already missing them.

-- ---------------------------------------------------------------------------
-- 1. Create the supporting rows with the employee
-- ---------------------------------------------------------------------------

create or replace function public.create_employee_transaction(
  p_employee_data jsonb,
  p_financial_data jsonb default null::jsonb,
  p_health_data jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_employee_id uuid;
  v_employee_record jsonb;
BEGIN
  INSERT INTO public.employees (
    first_name, last_name, email_address, job_title, employment_start_date, status,
    date_of_birth, address, post_code, phone_number, mobile_number, first_shift_date,
    uniform_preference, keyholder_status, employment_end_date
  ) VALUES (
    p_employee_data->>'first_name',
    p_employee_data->>'last_name',
    p_employee_data->>'email_address',
    p_employee_data->>'job_title',
    (p_employee_data->>'employment_start_date')::date,
    p_employee_data->>'status',
    (p_employee_data->>'date_of_birth')::date,
    p_employee_data->>'address',
    p_employee_data->>'post_code',
    p_employee_data->>'phone_number',
    p_employee_data->>'mobile_number',
    (p_employee_data->>'first_shift_date')::date,
    p_employee_data->>'uniform_preference',
    COALESCE((p_employee_data->>'keyholder_status')::boolean, false),
    (p_employee_data->>'employment_end_date')::date
  )
  RETURNING employee_id INTO v_employee_id;

  IF p_financial_data IS NOT NULL THEN
    INSERT INTO public.employee_financial_details (
      employee_id, ni_number, bank_account_number, bank_sort_code, bank_name, payee_name, branch_address
    ) VALUES (
      v_employee_id,
      p_financial_data->>'ni_number',
      p_financial_data->>'bank_account_number',
      p_financial_data->>'bank_sort_code',
      p_financial_data->>'bank_name',
      p_financial_data->>'payee_name',
      p_financial_data->>'branch_address'
    );
  END IF;

  IF p_health_data IS NOT NULL THEN
    INSERT INTO public.employee_health_records (
      employee_id, doctor_name, doctor_address, allergies, has_allergies,
      had_absence_over_2_weeks_last_3_years, had_outpatient_treatment_over_3_months_last_3_years,
      absence_or_treatment_details, illness_history, recent_treatment,
      has_diabetes, has_epilepsy, has_skin_condition, has_depressive_illness,
      has_bowel_problems, has_ear_problems, is_registered_disabled,
      disability_reg_number, disability_reg_expiry_date, disability_details
    ) VALUES (
      v_employee_id,
      p_health_data->>'doctor_name',
      p_health_data->>'doctor_address',
      p_health_data->>'allergies',
      COALESCE((p_health_data->>'has_allergies')::boolean, false),
      COALESCE((p_health_data->>'had_absence_over_2_weeks_last_3_years')::boolean, false),
      COALESCE((p_health_data->>'had_outpatient_treatment_over_3_months_last_3_years')::boolean, false),
      p_health_data->>'absence_or_treatment_details',
      p_health_data->>'illness_history',
      p_health_data->>'recent_treatment',
      COALESCE((p_health_data->>'has_diabetes')::boolean, false),
      COALESCE((p_health_data->>'has_epilepsy')::boolean, false),
      COALESCE((p_health_data->>'has_skin_condition')::boolean, false),
      COALESCE((p_health_data->>'has_depressive_illness')::boolean, false),
      COALESCE((p_health_data->>'has_bowel_problems')::boolean, false),
      COALESCE((p_health_data->>'has_ear_problems')::boolean, false),
      COALESCE((p_health_data->>'is_registered_disabled')::boolean, false),
      p_health_data->>'disability_reg_number',
      (p_health_data->>'disability_reg_expiry_date')::date,
      p_health_data->>'disability_details'
    );
  END IF;

  -- New: the invite path already creates these. The manual path never did, which is why five
  -- active employees have no checklist row and two have no pay settings.
  INSERT INTO public.employee_onboarding_checklist (employee_id, created_at, updated_at)
  VALUES (v_employee_id, NOW(), NOW())
  ON CONFLICT (employee_id) DO NOTHING;

  INSERT INTO public.employee_pay_settings (employee_id, pay_type)
  VALUES (v_employee_id, 'hourly')
  ON CONFLICT (employee_id) DO NOTHING;

  SELECT to_jsonb(e) INTO v_employee_record
  FROM public.employees e
  WHERE e.employee_id = v_employee_id;

  RETURN v_employee_record;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Backfill everyone already missing a row
-- ---------------------------------------------------------------------------

insert into public.employee_onboarding_checklist (employee_id, created_at, updated_at)
select e.employee_id, now(), now()
from public.employees e
where not exists (
  select 1 from public.employee_onboarding_checklist k where k.employee_id = e.employee_id
)
on conflict (employee_id) do nothing;

-- pay_type 'hourly' matches the default every existing row already carries, and the holiday
-- allowance column keeps its own default, so this changes nobody's pay.
insert into public.employee_pay_settings (employee_id, pay_type)
select e.employee_id, 'hourly'
from public.employees e
where e.status in ('Active', 'Started Separation')
  and not exists (
    select 1 from public.employee_pay_settings p where p.employee_id = e.employee_id
  )
on conflict (employee_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. An invite can now carry the employment start date
--
-- complete_employee_onboarding flips an employee to Active without one, which is why one
-- active employee has no start date and shows a blank length of service on the roster.
-- Setting it at invite time is the only point where the manager actually knows it.
-- ---------------------------------------------------------------------------

-- Both old overloads are dropped first. Leaving the two argument version in place alongside a
-- three argument one with a default would make a two argument call ambiguous to read, and the
-- old one does not create the pay settings row.
drop function if exists public.create_employee_invite(text);
drop function if exists public.create_employee_invite(text, text);

create function public.create_employee_invite(
  p_email text,
  p_job_title text default null::text,
  p_employment_start_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_employee_id UUID;
  v_token TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM employees e WHERE lower(e.email_address) = lower(p_email)) THEN
    RAISE EXCEPTION 'An employee with this email address already exists';
  END IF;

  INSERT INTO employees (
    email_address, job_title, employment_start_date, status, invited_at, created_at, updated_at
  ) VALUES (
    lower(p_email), p_job_title, p_employment_start_date, 'Onboarding', NOW(), NOW(), NOW()
  )
  RETURNING employees.employee_id INTO v_employee_id;

  INSERT INTO employee_invite_tokens (employee_id, email, invite_type)
  VALUES (v_employee_id, lower(p_email), 'onboarding')
  RETURNING employee_invite_tokens.token INTO v_token;

  INSERT INTO employee_onboarding_checklist (employee_id, created_at, updated_at)
  VALUES (v_employee_id, NOW(), NOW())
  ON CONFLICT (employee_id) DO NOTHING;

  INSERT INTO employee_pay_settings (employee_id, pay_type)
  VALUES (v_employee_id, 'hourly')
  ON CONFLICT (employee_id) DO NOTHING;

  RETURN jsonb_build_object('employee_id', v_employee_id, 'token', v_token);
END;
$function$;

